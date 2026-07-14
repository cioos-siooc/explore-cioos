"""Griddap (gridded dataset) handler.

Griddap datasets are harvested METADATA-ONLY: no per-feature rows are
produced. ``feature_kind = "dataset_extent"`` is routed to no feature table by
the harvester — the grid's extent, structure and variable list are set on the
Dataset object here and flow into datasets.csv via ``Dataset.get_df()``
(coverage_*, grid_variables, grid_dimensions columns on cde.datasets).

The one-row frame returned by ``extract_features`` only signals "extent
resolved" to the shared NO_PROFILES_FOUND skip check; an empty frame means the
dataset has no usable lat/lon extent and is legitimately skipped.
"""

import re

import pandas as pd
from cde_harvester.dataset_types.base import DatasetTypeHandler
from cde_harvester.dataset_types.tabledap_features import _axis_bounds_from_metadata
from cde_harvester.utils import eov_to_standard_name

# Reverse of eov_to_standard_name: CF standard name -> list of EOV keys, so a
# grid variable can be tagged with the ocean variables it represents (the same
# EOV mapping get_eovs() uses at the dataset level).
_standard_name_to_eovs = {}
for _eov, _standard_names in eov_to_standard_name.items():
    for _standard_name in _standard_names:
        _standard_name_to_eovs.setdefault(_standard_name, []).append(_eov)

_N_VALUES_RE = re.compile(r"nValues=(\d+)")
_EVENLY_SPACED_RE = re.compile(r"evenlySpaced=(true|false)")
_AVERAGE_SPACING_RE = re.compile(r"averageSpacing=(.+)$")


def _erddap_time_to_iso(value):
    """ERDDAP time value ('1.0257408E9' epoch seconds or an ISO 8601 string)
    -> ISO-8601 UTC string, or None when unparseable."""
    s = str(value).strip()
    if not s or s.lower() in ("nan", "none", "nat"):
        return None
    try:
        ts = pd.to_datetime(float(s), unit="s", utc=True)
    except (TypeError, ValueError):
        ts = pd.to_datetime(s, errors="coerce", utc=True)
    if pd.isna(ts):
        return None
    return ts.isoformat()


def _parse_dimension_attrs(value):
    """Parse an info-CSV dimension row's Value field, e.g.
    'nValues=5827, evenlySpaced=false, averageSpacing=1 day 3h 11m 48s'."""
    n_values = _N_VALUES_RE.search(value or "")
    even = _EVENLY_SPACED_RE.search(value or "")
    spacing = _AVERAGE_SPACING_RE.search(value or "")
    return (
        int(n_values.group(1)) if n_values else None,
        even.group(1) == "true" if even else None,
        spacing.group(1).strip() if spacing else None,
    )


def _actual_range(dataset, name):
    """(min, max) raw strings from a variable's actual_range, else None."""
    df_variables = dataset.df_variables
    if name not in df_variables.index:
        return None
    actual_range = df_variables.loc[name].get("actual_range")
    if not actual_range:
        return None
    parts = str(actual_range).split(",")
    if len(parts) != 2:
        return None
    return parts[0].strip(), parts[1].strip()


def _to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _wrap_lon(x):
    # already in range: return unchanged (the modulo round-trip loses
    # floating-point precision)
    if -180.0 <= x <= 180.0:
        return x
    wrapped = ((x + 180.0) % 360.0) - 180.0
    # keep an exact 180 east bound as 180 (the modulo folds it to -180)
    if wrapped == -180.0 and x != -180.0:
        return 180.0
    return wrapped


def normalize_lon_extent(lon_min, lon_max):
    """Normalize a grid's longitude extent to [-180, 180].

    Grids published on a 0..360 axis are wrapped; a result where min > max
    marks an antimeridian-crossing extent (the DB generated column splits it
    into a two-envelope MultiPolygon). A span >= 360 degrees is global.
    """
    if lon_max - lon_min >= 360:
        return -180.0, 180.0
    return _wrap_lon(lon_min), _wrap_lon(lon_max)


def _extract_dimensions(dataset):
    """[{name, n_values, min, max, spacing, even_spacing, units}] from the raw
    info frame's ``Row Type == "dimension"`` rows, in dataset order."""
    df_info = dataset.df_info
    dimensions = []
    dim_rows = df_info.query('`Row Type` == "dimension"')
    for _, row in dim_rows.iterrows():
        name = row["Variable Name"]
        value = row["Value"]
        n_values, even_spacing, spacing = _parse_dimension_attrs(value)
        var_meta = (
            dataset.df_variables.loc[name]
            if name in dataset.df_variables.index
            else {}
        )
        bounds = _actual_range(dataset, name) or (None, None)
        is_time = name == "time" or var_meta.get("standard_name") == "time"
        if is_time:
            lo, hi = _erddap_time_to_iso(bounds[0]), _erddap_time_to_iso(bounds[1])
        else:
            lo, hi = _to_float(bounds[0]), _to_float(bounds[1])
        dimensions.append(
            {
                "name": name,
                "n_values": n_values,
                "min": lo,
                "max": hi,
                "spacing": spacing,
                "even_spacing": even_spacing,
                "units": var_meta.get("units") or None,
            }
        )
    return dimensions


def _extract_variables(dataset):
    """[{name, standard_name, long_name, units, eovs}] for the data variables
    (``Row Type == "variable"`` — dimensions excluded). ``eovs`` is the list of
    EOV keys the variable's standard_name maps to (empty when it maps to none),
    letting the frontend default the WMS overlay to the first EOV-related
    variable."""
    df_info = dataset.df_info
    names = (
        df_info.query('`Row Type` == "variable"')["Variable Name"].unique().tolist()
    )
    variables = []
    for name in names:
        var_meta = (
            dataset.df_variables.loc[name]
            if name in dataset.df_variables.index
            else {}
        )
        standard_name = var_meta.get("standard_name") or None
        variables.append(
            {
                "name": name,
                "standard_name": standard_name,
                "long_name": var_meta.get("long_name") or None,
                "units": var_meta.get("units") or None,
                "eovs": _standard_name_to_eovs.get(standard_name, []),
            }
        )
    return variables


def _vertical_extent(dataset, dimensions):
    """(depth_min, depth_max) from geospatial_vertical_* globals, else the
    depth/altitude dimension range (altitude negated to depth-positive-down)."""
    lo = _to_float(dataset.globals.get("geospatial_vertical_min"))
    hi = _to_float(dataset.globals.get("geospatial_vertical_max"))
    if lo is not None and hi is not None:
        return lo, hi
    for dim in dimensions:
        if dim["name"] == "depth":
            return dim["min"], dim["max"]
        if dim["name"] == "altitude":
            alt_min, alt_max = dim["min"], dim["max"]
            if alt_min is not None and alt_max is not None:
                return -alt_max, -alt_min
    return None, None


def extract_grid_extent(dataset):
    logger = dataset.logger

    # Dataset.get_df() reads len(self.profile_ids); grids have no CF-role
    # feature identities (same trick as the trajectory handler).
    dataset.profile_ids = []

    lat_bounds = _axis_bounds_from_metadata(dataset, "latitude")
    lon_bounds = _axis_bounds_from_metadata(dataset, "longitude")
    if not (lat_bounds and lon_bounds):
        logger.warning("No lat/lon extent found in grid metadata")
        return pd.DataFrame()

    # actual_range order isn't guaranteed on descending axes — sort first.
    # Antimeridian crossings only arise from the 0..360 wrap in
    # normalize_lon_extent, never from the raw bounds order.
    lon_min, lon_max = normalize_lon_extent(*sorted(lon_bounds))
    dataset.coverage_lat_min = min(lat_bounds)
    dataset.coverage_lat_max = max(lat_bounds)
    dataset.coverage_lon_min = lon_min
    dataset.coverage_lon_max = lon_max

    dimensions = _extract_dimensions(dataset)
    dataset.grid_dimensions = dimensions
    dataset.grid_variables = _extract_variables(dataset)

    time_dim = next((d for d in dimensions if d["name"] == "time"), None)
    dataset.coverage_time_min = (
        time_dim and time_dim["min"]
    ) or _erddap_time_to_iso(dataset.globals.get("time_coverage_start"))
    dataset.coverage_time_max = (
        time_dim and time_dim["max"]
    ) or _erddap_time_to_iso(dataset.globals.get("time_coverage_end"))

    depth_min, depth_max = _vertical_extent(dataset, dimensions)
    dataset.coverage_depth_min = depth_min
    dataset.coverage_depth_max = depth_max

    # Marker row: non-empty = extent resolved (passes the shared
    # NO_PROFILES_FOUND check); the row itself is never persisted.
    return pd.DataFrame(
        [{"erddap_url": dataset.erddap_url, "dataset_id": dataset.id}]
    )


class GridHandler(DatasetTypeHandler):
    cdm_data_type = "Grid"
    data_structure = "grid"
    feature_kind = "dataset_extent"

    def extract_features(self, dataset):
        return extract_grid_extent(dataset)
