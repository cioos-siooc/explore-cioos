"""The downloader's per-format writers and polygon filter, and reproduce(),
which a package's reproduce.py runs to rebuild its data files from their
sources with this same code.

Text values are read and written back as strings, so numbers keep ERDDAP's
exact formatting; only latitude/longitude are parsed, for the polygon test.
"""

import functools
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
import pyarrow.compute as pc
import pyarrow.parquet as pq
import shapely
import shapely.affinity
import shapely.wkt
import xarray as xr

from cioos_downloader import darwin_core

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


_WRITERS = {"csv": _write_csv, "odv": _write_odv, "parquet": _write_parquet, "nccf": _write_nccf}


def write_subset(format_key, parts, regions, out_base: Path):
    """Filter raw response files ``parts`` to ``regions`` (empty = no polygon)
    and write them next to ``out_base`` (no extension). Returns
    ``[{path, n_rows, columns: [{name, unit}]}]``; [] when nothing is left."""
    return _WRITERS[format_key](parts, regions, out_base)


def _epoch_ms(value):
    return int(pd.to_datetime(value, utc=True).timestamp() * 1000) if value else None


_OBIS_BATCH_ROWS = 100_000
_OBIS_THREADS = 2
# The OBIS-curated values, or the provider's as submitted to OBIS.
OBIS_VALUES = {"curated": "interpreted", "submitted": "source"}


def _populated(con, url):
    """Column paths ("interpreted, eventDate") holding any value in the export,
    from the footer's statistics; a column without them counts as populated."""
    rows = con.execute(
        "SELECT path_in_schema, sum(stats_null_count), sum(num_values) FROM parquet_metadata($url) GROUP BY 1",
        {"url": url},
    ).fetchall()
    return {path for path, nulls, n in rows if nulls is None or nulls < n}


def _leaves(struct_type, prefix, populated):
    """The struct's scalar or list fields with a value somewhere in the export."""
    names = []
    for field in struct_type:
        path = f"{prefix}, {field.name}"
        if pa.types.is_struct(field.type):
            continue
        if pa.types.is_list(field.type):
            path += ", list, element"
        if path in populated:
            names.append(field)
    return names


def _sql_name(name):
    return '"' + name.replace('"', '""') + '"'


class _Table:
    """A CSV, tab-separated or Parquet file written batch by batch, created
    with the first batch. Text is staged as Parquet in ``tmp`` and written by
    DuckDB, which quotes only the values that need it."""

    def __init__(self, path: Path, kind, tmp: Path):
        self.path, self.kind, self.columns, self.n_rows, self.writer = path, kind, [], 0, None
        self.staged = path if kind == "parquet" else tmp / f"{path.name}.parquet"

    def write(self, batch):
        if not batch.num_rows:
            return
        if self.writer is None:
            self.writer = pq.ParquetWriter(self.staged, batch.schema)
            self.columns = batch.schema.names
        self.writer.write_batch(batch)
        self.n_rows += batch.num_rows

    def close(self):
        if self.writer is not None:
            self.writer.close()

    def finish(self, con):
        if self.writer is not None and self.kind != "parquet":
            delimiter = "\t" if self.kind == "tsv" else ","
            con.execute(
                f"COPY (SELECT * FROM read_parquet({_sql_string(self.staged)})) "
                f"TO {_sql_string(self.path)} (FORMAT csv, HEADER, DELIMITER '{delimiter}')"
            )

    def entry(self):
        return {"path": self.path, "n_rows": self.n_rows, "columns": [{"name": n, "unit": ""} for n in self.columns]}


def _sql_string(value):
    return "'" + str(value).replace("'", "''") + "'"


def write_obis(format_key, url, user_query, regions, out_base: Path, values="curated", eml: Path | None = None):
    """The OBIS occurrences of the parquet export at ``url`` matching the query,
    with their Darwin Core fields (``values`` picks OBIS's curated ones or the
    provider's), and their measurement and DNA records: as CSV or Parquet
    tables, or one Darwin Core Archive (``dwca``) with ``eml`` as its
    metadata. Only fields holding a value in the dataset are written. Returns
    the occurrence file first; [] when no occurrence matches."""
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
    struct = OBIS_VALUES[values]
    archive = format_key == "dwca"
    eml = eml if eml and eml.exists() else None

    # Own connection: the shared default one breaks under concurrent subsets.
    # Few threads: each buffers whole row groups of the ~250-field structs,
    # and a 1M-occurrence dataset otherwise peaks near 3 GB.
    with duckdb.connect(config={"threads": _OBIS_THREADS}) as con:
        schema = con.sql("SELECT * FROM read_parquet($url) LIMIT 0", params={"url": url}).to_arrow_table().schema
        populated = _populated(con, url)
        fields = _leaves(schema.field(struct).type, struct, populated)
        if archive:
            fields = [f for f in fields if f.name in darwin_core.OCCURRENCE_TERMS]
        select = ["_id AS id"]
        for field in fields:
            column = f"{struct}.{_sql_name(field.name)}"
            if pa.types.is_list(field.type):
                column = f"array_to_string({column}, '|')"
            select.append(f"{column} AS {_sql_name(field.name)}")
        core_columns = ["id", *(f.name for f in fields)]
        # OBIS's quality flags go with its curated values; they aren't Darwin Core.
        if struct == "interpreted" and not archive and "flags, list, element" in populated:
            select.append("array_to_string(flags, '|') AS flags")
            core_columns.append("flags")

        # Each extension's source fields with a value somewhere in the export.
        extension_type = schema.field("extensions").type if "extensions" in schema.names else pa.struct([])
        extensions = []
        for i, row_type in enumerate(darwin_core.EXTENSIONS):
            if extension_type.get_field_index(row_type) < 0:
                continue
            prefix = f"extensions, {row_type}, list, element, source"
            source = extension_type.field(row_type).type.value_type.field("source").type
            names = [f.name for f in _leaves(source, prefix, populated)]
            if archive:
                names = [n for n in names if n in darwin_core.EXTENSIONS[row_type][1]]
            if names:
                select.append(f"extensions.{_sql_name(row_type)} AS __extension{i}")
                extensions.append((row_type, f"__extension{i}", names))

        query = f"""
            SELECT {", ".join(select)},
                   interpreted.decimalLongitude AS __lon,
                   interpreted.decimalLatitude  AS __lat
            FROM read_parquet($url)
            WHERE interpreted.decimalLatitude  BETWEEN $lat_min AND $lat_max
              AND interpreted.decimalLongitude BETWEEN $lon_min AND $lon_max
              AND ($depth_max IS NULL OR coalesce(interpreted.minimumDepthInMeters, 0) <= $depth_max)
              AND ($depth_min IS NULL OR coalesce(interpreted.maximumDepthInMeters, 0) >= $depth_min)
              AND ($time_min IS NULL OR interpreted.date_end >= $time_min)
              AND ($time_max IS NULL OR interpreted.date_start <= $time_max)
        """

        with tempfile.TemporaryDirectory(dir=out_base.parent) as tmp:
            if archive:
                kind, core_path = "tsv", Path(tmp) / "occurrence.txt"
            else:
                kind = "parquet" if format_key == "parquet" else "csv"
                core_path = out_base.with_suffix(f".{kind}")
            core = _Table(core_path, kind, Path(tmp))
            tables = {
                row_type: _Table(
                    Path(tmp) / f"{stem}.txt" if archive else out_base.with_name(f"{out_base.name}_{stem}.{kind}"),
                    kind,
                    Path(tmp),
                )
                for row_type, (stem, _) in darwin_core.EXTENSIONS.items()
            }
            try:
                for batch in con.sql(query, params=params).to_arrow_reader(_OBIS_BATCH_ROWS):
                    if regions:
                        batch = batch.filter(pa.array(inside(batch["__lon"], batch["__lat"], regions)))
                    core.write(batch.select(core_columns))
                    for row_type, column, names in extensions:
                        lists = batch[column]
                        source = pc.list_flatten(lists).field("source")
                        ids = batch["id"].take(pc.list_parent_indices(lists))
                        records = pa.record_batch([ids, *(source.field(n) for n in names)], names=["id", *names])
                        # OBIS exports records holding nothing but their occurrence's ID.
                        content = [pc.is_valid(records[n]) for n in names if n != "occurrenceID"]
                        if content:
                            records = records.filter(functools.reduce(pc.or_, content))
                        tables[row_type].write(records)
            finally:
                for table in (core, *tables.values()):
                    table.close()

            if not core.n_rows:
                return []
            written = [t for t in (core, *tables.values()) if t.n_rows]
            for table in written:
                table.finish(con)
            if not archive:
                return [t.entry() for t in written]

            path = out_base.with_name(out_base.name + ".dwca.zip")
            extension_columns = [(rt, t.columns) for rt, t in tables.items() if t.n_rows]
            meta = darwin_core.meta_xml(core.columns, extension_columns, eml)
            files = {t.path.name: t.path for t in written}
            darwin_core.write_archive(path, files, meta, eml)
            return [{**core.entry(), "path": path}]


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


def _rebuild(subset, query, regions, out_base: Path, tmp: Path, metadata: Path):
    out_base.parent.mkdir(parents=True, exist_ok=True)
    if subset["source_type"] == "obis":
        values = query.get("obis_values") or "curated"
        url = subset["request_urls"][0]
        return write_obis(subset["format"], url, query, regions, out_base, values, metadata / "eml.xml")
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
                files = _rebuild(
                    subset, query, regions, out / folder / subset["folder"], Path(tmp), root / folder / "metadata"
                )
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
