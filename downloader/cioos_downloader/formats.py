"""The downloader's per-format writers and polygon filter, and reproduce(),
which a package's reproduce.py runs to rebuild its data files from their
sources with this same code.

Text values are read and written back as strings, so numbers keep ERDDAP's
exact formatting; only latitude/longitude are parsed, for the polygon test.
"""

import hashlib
import json
import shutil
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import shapely
import shapely.affinity
import shapely.wkt
import xarray as xr

# Some ERDDAP servers (e.g. data.cioospacific.ca) sit behind a WAF that 403s
# urllib's default User-Agent.
REQUEST_HEADERS = {"User-Agent": "CIOOS-CDE-Downloader/1.0 (+https://catalogue.cioos.ca)"}


def polygon_regions(polygon_wkt):
    """The user's polygon, plus ±360° copies when it crosses the antimeridian
    so each side gets its own query."""
    if not polygon_wkt:
        return []
    regions = [shapely.wkt.loads(polygon_wkt)]
    lon_min, _, lon_max, _ = regions[0].bounds
    if lon_min < -180 or lon_max > 180:
        for shift in (-360, 360):
            shifted = shapely.affinity.translate(regions[0], xoff=shift)
            if -180 < shifted.bounds[0] < 180 or -180 < shifted.bounds[2] < 180:
                regions.append(shifted)
    return regions


def _number(value):
    if value is None or value == "" or pd.isna(value):
        return None
    return float(value)


def query_box(user_query, region):
    """(lon_min, lat_min, lon_max, lat_max), longitudes clamped to ±180; None
    when the query carries no complete box."""
    if region is not None:
        lon_min, lat_min, lon_max, lat_max = region.bounds
    else:
        lon_min, lat_min, lon_max, lat_max = (
            _number(user_query.get(k)) for k in ("lon_min", "lat_min", "lon_max", "lat_max")
        )
        if None in (lon_min, lat_min, lon_max, lat_max):
            return None
    return max(lon_min, -180), lat_min, min(lon_max, 180), lat_max


def inside(lon, lat, regions):
    """Row mask of points inside any region; unparseable coordinates are outside."""
    lon = pd.to_numeric(pd.Series(np.asarray(lon)), errors="coerce").to_numpy(float)
    lat = pd.to_numeric(pd.Series(np.asarray(lat)), errors="coerce").to_numpy(float)
    mask = np.zeros(len(lon), dtype=bool)
    for region in regions:
        mask |= shapely.contains_xy(region, lon, lat)
    return mask


def _column(df, prefix):
    return next(c for c in df.columns if c.lower().startswith(prefix))


def _filter_frame(df, regions, lon="longitude", lat="latitude"):
    if not regions or df.empty:
        return df
    return df[inside(df[_column(df, lon)], df[_column(df, lat)], regions)]


def _write_csv(parts, regions, out_base):
    frames, units = [], None
    for part in parts:
        df = pd.read_csv(part, dtype=str, keep_default_na=False)
        # ERDDAP CSV: header on the first line, units on the second.
        units = df.iloc[0] if units is None else units
        frames.append(_filter_frame(df.iloc[1:], regions))
    df = pd.concat(frames)
    if df.empty:
        return []
    path = out_base.with_suffix(".csv")
    with open(path, "w", newline="") as f:
        pd.DataFrame([units.to_list()], columns=df.columns).to_csv(f, index=False, lineterminator="\n")
        df.to_csv(f, header=False, index=False, lineterminator="\n")
    columns = [{"name": c, "unit": units[c]} for c in df.columns]
    return [{"path": path, "n_rows": len(df), "columns": columns}]


def _odv_header(path):
    with open(path, encoding="utf-8") as f:
        header = []
        for line in f:
            if not line.startswith("//"):
                break
            header.append(line)
    return header


def _odv_unit(name):
    return name[name.find("[") + 1 : name.rfind("]")] if name.endswith("]") else ""


def _write_odv(parts, regions, out_base):
    header, frames = None, []
    for part in parts:
        comments = _odv_header(part)
        header = comments if header is None else header
        df = pd.read_csv(
            part, sep="\t", skiprows=len(comments), dtype=str, keep_default_na=False
        )
        frames.append(_filter_frame(df, regions))
    df = pd.concat(frames)
    if df.empty:
        return []
    path = out_base.with_suffix(".txt")
    with open(path, "w", encoding="utf-8", newline="") as f:
        f.writelines(header)
        df.to_csv(f, sep="\t", index=False, lineterminator="\n")
    columns = [{"name": c, "unit": _odv_unit(c)} for c in df.columns]
    return [{"path": path, "n_rows": len(df), "columns": columns}]


def _write_parquet(parts, regions, out_base):
    tables = []
    for part in parts:
        table = pq.read_table(part)
        if regions and table.num_rows:
            table = table.filter(
                pa.array(inside(table["longitude"], table["latitude"], regions))
            )
        tables.append(table)
    table = pa.concat_tables(tables, promote_options="permissive")
    if not table.num_rows:
        return []
    path = out_base.with_suffix(".parquet")
    pq.write_table(table, path)
    attrs = table.schema.metadata or {}
    columns = [
        {"name": name, "unit": attrs.get(f"{name}_units".encode(), b"").decode()}
        for name in table.schema.names
    ]
    return [{"path": path, "n_rows": table.num_rows, "columns": columns}]


def _variable_with_attr(ds, attr):
    return next((ds[name] for name, v in ds.variables.items() if attr in v.attrs), None)


def _obs_dim(ds):
    row_size = _variable_with_attr(ds, "sample_dimension")
    return row_size.attrs["sample_dimension"] if row_size is not None else ds["latitude"].dims[0]


def filter_ragged(ds, regions):
    """Polygon-filter an ERDDAP .ncCF dataset (a CF DSG ragged array).

    lat/lon may live on the observation, the feature (profile, trajectory) or,
    for timeSeriesProfile/trajectoryProfile, the parent instance; each is
    expanded to one value per observation, observations outside are dropped,
    and the ragged bookkeeping (rowSize, the parent index) is rebuilt.
    """
    row_size = _variable_with_attr(ds, "sample_dimension")
    parent_index = _variable_with_attr(ds, "instance_dimension")
    obs_dim = _obs_dim(ds)
    feature_dim = row_size.dims[0] if row_size is not None else None
    parent_dim = parent_index.attrs["instance_dimension"] if parent_index is not None else None
    sizes = row_size.values.astype(int) if row_size is not None else None

    def per_obs(var):
        values = var.values
        if var.dims[0] == parent_dim:
            values = values[parent_index.values]
        if var.dims[0] in (parent_dim, feature_dim):
            values = np.repeat(values, sizes)
        return values

    mask = inside(per_obs(ds["longitude"]), per_obs(ds["latitude"]), regions)
    if row_size is None:
        return ds.isel({obs_dim: mask})

    feature_of_obs = np.repeat(np.arange(len(sizes)), sizes)
    new_sizes = np.bincount(feature_of_obs[mask], minlength=len(sizes))
    keep_feature = new_sizes > 0
    ds = ds.isel({obs_dim: mask, feature_dim: keep_feature})
    ds[row_size.name] = (feature_dim, new_sizes[keep_feature].astype(row_size.dtype), row_size.attrs)

    if parent_index is not None:
        kept = parent_index.values[keep_feature]
        parents = np.unique(kept)
        ds = ds.isel({parent_dim: parents})
        ds[parent_index.name] = (
            feature_dim,
            np.searchsorted(parents, kept).astype(parent_index.dtype),
            parent_index.attrs,
        )
    return ds


def _update_bounds(ds):
    for axis in ("lat", "lon"):
        var = ds["latitude" if axis == "lat" else "longitude"]
        values = var.values.astype(float)
        fill = var.attrs.get("_FillValue")
        values = values[np.isfinite(values) & (values != fill if fill is not None else True)]
        if values.size and f"geospatial_{axis}_min" in ds.attrs:
            ds.attrs[f"geospatial_{axis}_min"] = values.min()
            ds.attrs[f"geospatial_{axis}_max"] = values.max()


def _write_nccf(parts, regions, out_base):
    written = []
    for i, part in enumerate(parts):
        # Raw values and attributes, so the file is rewritten exactly as ERDDAP
        # encoded it rather than round-tripped through CF decoding.
        with xr.open_dataset(part, decode_cf=False, mask_and_scale=False) as ds:
            ds = ds.load()
        if regions:
            ds = filter_ragged(ds, regions)
            _update_bounds(ds)
        n_rows = ds.sizes[_obs_dim(ds)]
        if not n_rows:
            continue
        suffix = f"_part{i + 1}.nc" if len(parts) > 1 else ".nc"
        path = out_base.with_name(out_base.name + suffix)
        ds.to_netcdf(path)
        columns = [{"name": name, "unit": v.attrs.get("units", "")} for name, v in ds.data_vars.items()]
        written.append({"path": path, "n_rows": int(n_rows), "columns": columns})
    return written


# ERDDAP's other tabledap file types (key: suffix, mediatype, label). The
# downloader can't parse them, so they ship as ERDDAP wrote them: a polygon only
# reaches them as its bounding box, in the request.
RAW_FORMATS = {
    "csvp": (".csv", "text/csv", "CSV, units in header"),
    "csv0": (".csv", "text/csv", "CSV, no header"),
    "tsv": (".tsv", "text/tab-separated-values", "TSV"),
    "tsvp": (".tsv", "text/tab-separated-values", "TSV, units in header"),
    "tsv0": (".tsv", "text/tab-separated-values", "TSV, no header"),
    "nccsv": (".csv", "text/csv", "NCCSV"),
    "esriCsv": (".csv", "text/csv", "Esri CSV"),
    "json": (".json", "application/json", "JSON table"),
    "jsonlCSV1": (".jsonl", "application/jsonl", "JSON Lines, header row"),
    "jsonlCSV": (".jsonl", "application/jsonl", "JSON Lines, arrays"),
    "jsonlKVP": (".jsonl", "application/jsonl", "JSON Lines, objects"),
    "geoJson": (".geojson", "application/geo+json", "GeoJSON"),
    "ncoJson": (".json", "application/json", "NCO JSON"),
    "dataTable": (".json", "application/json", "Google Visualization table"),
    "nc": (".nc", "application/x-netcdf", "NetCDF-3, flat table"),
    "ncCFMA": (".nc", "application/x-netcdf", "NetCDF CF (DSG), multidimensional"),
    "mat": (".mat", "application/x-matlab-data", "MATLAB"),
    "itx": (".itx", "text/plain", "Igor Text"),
    "asc": (".asc", "text/plain", "OPeNDAP ASCII"),
    "dods": (".dods", "application/octet-stream", "OPeNDAP binary"),
    "htmlTable": (".html", "text/html", "HTML table"),
    "xhtml": (".xhtml", "application/xhtml+xml", "XHTML table"),
    "kml": (".kml", "application/vnd.google-earth.kml+xml", "KML"),
}


def _raw_writer(suffix):
    def write(parts, regions, out_base):
        written = []
        for i, part in enumerate(parts):
            path = out_base.with_name(out_base.name + (f"_part{i + 1}" if len(parts) > 1 else "") + suffix)
            shutil.copyfile(part, path)
            written.append({"path": path, "n_rows": None, "columns": []})
        return written

    return write


_CLIPPING_WRITERS = {"csv": _write_csv, "odv": _write_odv, "parquet": _write_parquet, "nccf": _write_nccf}
CLIPPABLE_FORMATS = tuple(_CLIPPING_WRITERS)
_WRITERS = {**_CLIPPING_WRITERS, **{key: _raw_writer(suffix) for key, (suffix, _, _) in RAW_FORMATS.items()}}


def write_subset(format_key, parts, regions, out_base: Path):
    """Filter raw response files ``parts`` to ``regions`` (empty = no polygon)
    and write them next to ``out_base`` (no extension). Returns
    ``[{path, n_rows, columns: [{name, unit}]}]``, n_rows None for a raw
    format; [] when nothing is left."""
    return _WRITERS[format_key](parts, regions, out_base)


def _epoch_ms(value):
    return int(pd.to_datetime(value, utc=True).timestamp() * 1000) if value else None


def write_obis(format_key, url, user_query, regions, out_base: Path):
    """The OBIS occurrences of the parquet export at ``url`` matching the query,
    as CSV or Parquet; [] when none match."""
    if regions:
        lon_min, lat_min, lon_max, lat_max = shapely.total_bounds(regions)
    else:
        lon_min, lat_min, lon_max, lat_max = query_box(user_query, None) or (-180, -90, 180, 90)
    params = {
        "url": url,
        "lon_min": max(lon_min, -180),
        "lon_max": min(lon_max, 180),
        "lat_min": max(lat_min, -85.06),
        "lat_max": min(lat_max, 85.06),
        "depth_min": _number(user_query.get("depth_min")),
        "depth_max": _number(user_query.get("depth_max")),
        "time_min": _epoch_ms(user_query.get("time_min")),
        "time_max": _epoch_ms(user_query.get("time_max")),
    }
    # The same columns the harvester reads; reliably present across OBIS
    # exports. date_start/date_end are epoch milliseconds.
    query = """
        SELECT
            _id                              AS id,
            interpreted.scientificName       AS scientificName,
            interpreted.decimalLatitude      AS latitude,
            interpreted.decimalLongitude     AS longitude,
            interpreted.date_start           AS date_start,
            interpreted.date_end             AS date_end,
            interpreted.minimumDepthInMeters AS minimumDepthInMeters,
            interpreted.maximumDepthInMeters AS maximumDepthInMeters
        FROM read_parquet($url)
        WHERE interpreted.decimalLatitude  BETWEEN $lat_min AND $lat_max
          AND interpreted.decimalLongitude BETWEEN $lon_min AND $lon_max
          AND ($depth_max IS NULL OR coalesce(interpreted.minimumDepthInMeters, 0) <= $depth_max)
          AND ($depth_min IS NULL OR coalesce(interpreted.maximumDepthInMeters, 0) >= $depth_min)
          AND ($time_min IS NULL OR interpreted.date_end >= $time_min)
          AND ($time_max IS NULL OR interpreted.date_start <= $time_max)
    """
    # Own connection: the shared default one breaks under concurrent subsets.
    with duckdb.connect() as con:
        df = con.execute(query, params).df()
    if regions:
        df = df[inside(df["longitude"], df["latitude"], regions)]
    if df.empty:
        return []

    if format_key == "parquet":
        path = out_base.with_suffix(".parquet")
        df.to_parquet(path, index=False)
    else:
        path = out_base.with_suffix(".csv")
        df.to_csv(path, index=False, lineterminator="\n")
    columns = [{"name": c, "unit": ""} for c in df.columns]
    return [{"path": path, "n_rows": len(df), "columns": columns}]


def sha256(path):
    with open(path, "rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def _fetch(url, path):
    """False when ERDDAP answers that nothing matches this request."""
    request = urllib.request.Request(url, headers=REQUEST_HEADERS)
    try:
        with urllib.request.urlopen(request, timeout=600) as response, open(path, "wb") as f:
            shutil.copyfileobj(response, f)
    except urllib.error.HTTPError as e:
        if e.code == 404 and b"no matching results" in e.read():
            return False
        raise
    return True


def _rebuild(subset, query, regions, out_base: Path, tmp: Path):
    out_base.parent.mkdir(parents=True, exist_ok=True)
    if subset["source_type"] == "obis":
        return write_obis(subset["format"], subset["request_urls"][0], query, regions, out_base)
    parts = []
    for i, url in enumerate(subset["request_urls"]):
        part = tmp / f"{subset['folder']}.part{i}"
        if _fetch(url, part):
            parts.append(part)
    return write_subset(subset["format"], parts, regions, out_base) if parts else []


def reproduce(root: Path):
    """Re-fetch every subset of the package in ``root`` from the request URLs
    recorded in datapackage.json, write it to reproduced/ and compare each file
    with the checksum of the one in the package."""
    out = root / "reproduced"
    package = json.loads((root / "datapackage.json").read_text())
    query = package["x-cde-query"]
    regions = polygon_regions(query.get("polygon_region"))
    expected = {r["path"]: r["hash"].removeprefix("sha256:") for r in package["resources"] if "hash" in r}

    differs = 0
    with tempfile.TemporaryDirectory() as tmp:
        for subset in package["x-cde-subsets"]:
            print(f"{subset['dataset_id']}:")
            folder = f"data/{subset['folder']}"
            try:
                files = _rebuild(subset, query, regions, out / folder / subset["folder"], Path(tmp))
            except Exception as e:
                print(f"  failed: {type(e).__name__}: {e}")
                differs += 1
                continue
            written = {f["path"].relative_to(out).as_posix(): f["path"] for f in files}
            for path in sorted({p for p in expected if p.startswith(folder + "/")} | set(written)):
                if path not in written:
                    status = "missing"
                elif path not in expected:
                    status = "extra"
                else:
                    status = "match" if sha256(written[path]) == expected[path] else "differs"
                differs += status != "match"
                print(f"  {status}: {path}")
            if subset["status"] == "PARTIAL":
                print("  note: the package copy was cut off at the size limit, so the full rebuild differs")

    if differs:
        print("\nSome files differ: the source data may have changed since the package was built.")
    print(f"\nRebuilt files are in {out}")
    return 1 if differs else 0
