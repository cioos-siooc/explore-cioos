"""Output formats: each turns the raw ERDDAP response parts of one subset into
the polygon-filtered file(s) shipped in the package.

Text values are read and written back as strings, so numbers keep ERDDAP's
exact formatting; only latitude/longitude are parsed, for the polygon test.
"""

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import shapely
import xarray as xr


@dataclass(frozen=True)
class Format:
    key: str
    erddap_response: str
    extension: str
    mediatype: str
    # A truncated binary response is unreadable, so it can't ship as PARTIAL.
    binary: bool
    label: str


FORMATS = {
    f.key: f
    for f in (
        Format("csv", "csv", "csv", "text/csv", False, "CSV"),
        Format("parquet", "parquetWMeta", "parquet", "application/vnd.apache.parquet", True, "Parquet"),
        Format("odv", "odvTxt", "txt", "text/tab-separated-values", False, "ODV spreadsheet"),
        Format("nccf", "ncCF", "nc", "application/x-netcdf", True, "NetCDF CF (DSG)"),
    )
}
DEFAULT_FORMAT = "csv"
# OBIS occurrences are a flat table: there is no ODV or CF-DSG rendition of it.
OBIS_FORMATS = ("csv", "parquet")


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


def write_frame(format_key, df, out_base: Path):
    """An in-memory table (OBIS occurrences) in ``format_key``."""
    if format_key == "parquet":
        path = out_base.with_suffix(".parquet")
        df.to_parquet(path, index=False)
    else:
        path = out_base.with_suffix(".csv")
        df.to_csv(path, index=False, lineterminator="\n")
    columns = [{"name": c, "unit": ""} for c in df.columns]
    return [{"path": path, "n_rows": len(df), "columns": columns}]
