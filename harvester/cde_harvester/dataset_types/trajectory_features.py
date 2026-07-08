"""Trajectory coverage-cell extraction.

Trajectory / TrajectoryProfile datasets (gliders, drifters, ships underway)
have a moving position per record, so the one-lat/lon-per-feature profile
pipeline doesn't apply. Instead the track is reduced to coverage cells: one
row per (trajectory, 1/12-degree grid cell) with time/depth extents and a
record count — the same representation obis_cells uses for occurrences.

The reduction happens ON THE ERDDAP SERVER via orderBy* grouping with the
``variable/interval`` syntax (orderByMinMax("traj,latitude/0.08333333,...")),
so the response size is the number of occupied cells (KB), never the
full-resolution track. Servers whose ERDDAP predates interval grouping fall
back to downloading only the id/lat/lon/time/depth columns in yearly chunks
and binning in pandas (bounded by MAX_RESPONSE_SIZE).
"""

import logging

import pandas as pd
import requests
from requests.exceptions import HTTPError

from cde_harvester.sources.erddap.client import ERDDAP

logger = logging.getLogger(__name__)

# Bin size for coverage cells: 1/12 degree (~5 NM), matching the OBIS cell
# grid (obis harvester GRID_DEG) so both cell tables aggregate comparably.
GRID_DEG = 1 / 12
# Interval literal sent to ERDDAP (8 dp keeps the URL stable for caching).
GRID_INTERVAL = f"{GRID_DEG:.8f}"

# Track-point downsampling for plain Trajectory datasets (ships/drifters can
# report every few seconds): keep the first fix of each UTC day.
TRACK_INTERVAL = "1day"
# Hard per-trajectory cap on retained fixes; decimation keeps first/last and
# an even stride between. At Argo cadence (~1 fix / 10 days) this never bites;
# it bounds pathological high-frequency trajectories and the
# /trajectories/track response size.
MAX_TRACK_POINTS_PER_TRAJECTORY = 5000


def _snap(series):
    """Snap coordinates to the canonical cell grid (round-to-nearest, 8 dp).

    Applied to every server response as well: if the server returned binned
    values they are already multiples of the grid and snap to themselves; if
    it returned raw row values they land on the nearest cell.
    """
    return ((series.astype(float) / GRID_DEG).round() * GRID_DEG).round(8)


def _group_clause(traj_var):
    parts = ([traj_var] if traj_var else []) + [
        f"latitude/{GRID_INTERVAL}",
        f"longitude/{GRID_INTERVAL}",
    ]
    return ",".join(parts)


def _binned_min_max(dataset, traj_var, target_var):
    """Per-cell min/max of target_var via server-side interval grouping.

    Returns a DataFrame with [traj_var?, latitude, longitude, target_var]
    (two rows per cell), or empty on no data.
    """
    request_vars = ([traj_var] if traj_var else []) + [
        "latitude", "longitude", target_var,
    ]
    url = ",".join(request_vars) + requests.utils.quote(
        f'&orderByMinMax("{_group_clause(traj_var)},{target_var}")'
    )
    return dataset.dataset_tabledap_query(url)


def _binned_count(dataset, traj_var):
    """Per-cell record count (of time values) via orderByCount."""
    request_vars = ([traj_var] if traj_var else []) + [
        "latitude", "longitude", "time",
    ]
    url = ",".join(request_vars) + requests.utils.quote(
        f'&orderByCount("{_group_clause(traj_var)}")'
    )
    return dataset.dataset_tabledap_query(url)


def _aggregate(df, traj_var, has_depth):
    """Bin a [traj?, latitude, longitude, time(, depth)] frame into cells."""
    df = df.dropna(subset=["latitude", "longitude"]).copy()
    if df.empty:
        return df
    df["latitude"] = _snap(df["latitude"])
    df["longitude"] = _snap(df["longitude"])
    if traj_var:
        df[traj_var] = df[traj_var].astype(str)
    group_cols = ([traj_var] if traj_var else []) + ["latitude", "longitude"]

    df["time"] = ERDDAP.parse_erddap_dates(df["time"])
    agg = {
        "time_min": ("time", "min"),
        "time_max": ("time", "max"),
        "n_records": ("time", "count"),
    }
    if has_depth:
        df["depth"] = pd.to_numeric(df["depth"], errors="coerce")
        agg["depth_min"] = ("depth", "min")
        agg["depth_max"] = ("depth", "max")
    return df.groupby(group_cols, dropna=False).agg(**agg).reset_index()


def _extract_via_server_binning(dataset, traj_var, has_depth):
    """Primary path: three small grouped queries, all reduced server-side."""
    df_time = _binned_min_max(dataset, traj_var, "time")
    if df_time.empty:
        return pd.DataFrame()

    cells = _aggregate(df_time, traj_var, has_depth=False)

    if has_depth:
        df_depth = _binned_min_max(dataset, traj_var, "depth")
        if not df_depth.empty:
            df_depth = df_depth.dropna(subset=["latitude", "longitude"]).copy()
            df_depth["latitude"] = _snap(df_depth["latitude"])
            df_depth["longitude"] = _snap(df_depth["longitude"])
            if traj_var:
                df_depth[traj_var] = df_depth[traj_var].astype(str)
            df_depth["depth"] = pd.to_numeric(df_depth["depth"], errors="coerce")
            group_cols = ([traj_var] if traj_var else []) + ["latitude", "longitude"]
            depth_cells = (
                df_depth.groupby(group_cols, dropna=False)
                .agg(depth_min=("depth", "min"), depth_max=("depth", "max"))
                .reset_index()
            )
            cells = cells.merge(depth_cells, on=group_cols, how="left")

    df_count = _binned_count(dataset, traj_var)
    if not df_count.empty:
        df_count = df_count.dropna(subset=["latitude", "longitude"]).copy()
        df_count["latitude"] = _snap(df_count["latitude"])
        df_count["longitude"] = _snap(df_count["longitude"])
        if traj_var:
            df_count[traj_var] = df_count[traj_var].astype(str)
        group_cols = ([traj_var] if traj_var else []) + ["latitude", "longitude"]
        df_count["time"] = pd.to_numeric(df_count["time"], errors="coerce")
        counts = (
            df_count.groupby(group_cols, dropna=False)
            .agg(count_records=("time", "sum"))
            .reset_index()
        )
        cells = cells.merge(counts, on=group_cols, how="left")
        # orderByCount is the authoritative count; the min/max response only
        # contributed 2 rows per cell.
        cells["n_records"] = cells["count_records"].fillna(cells["n_records"])
        cells = cells.drop(columns=["count_records"])

    return cells


def _iter_raw_chunks(dataset, traj_var, has_depth):
    """Yield raw [traj?, latitude, longitude, time(, depth)] frames in yearly
    chunks — the shared download loop for both fallback paths (cell binning
    and track-point downsampling). Each chunk is bounded by MAX_RESPONSE_SIZE;
    failed chunks are logged and skipped."""
    log = dataset.logger
    request_vars = ([traj_var] if traj_var else []) + ["latitude", "longitude", "time"]
    if has_depth:
        request_vars.append("depth")
    columns = ",".join(request_vars)

    start = pd.to_datetime(
        dataset.globals.get("time_coverage_start"), errors="coerce", utc=True
    )
    end = pd.to_datetime(
        dataset.globals.get("time_coverage_end"), errors="coerce", utc=True
    )

    if pd.isna(start) or pd.isna(end):
        chunks = [""]  # no coverage metadata — single unchunked query
    else:
        # Yearly chunk starts, plus a final bound past the end so a dataset
        # shorter than one chunk still yields exactly one query.
        bounds = list(pd.date_range(start.floor("D"), end.ceil("D"), freq="365D"))
        bounds.append(end.ceil("D") + pd.Timedelta(days=1))
        chunks = [
            f"&time>={a.strftime('%Y-%m-%dT%H:%M:%SZ')}&time<{b.strftime('%Y-%m-%dT%H:%M:%SZ')}"
            for a, b in zip(bounds[:-1], bounds[1:])
        ]

    for time_query in chunks:
        try:
            df = dataset.dataset_tabledap_query(columns + time_query)
        except HTTPError:
            log.warning("Trajectory fallback chunk failed, skipping: %s", time_query)
            continue
        if df.empty:
            continue
        yield df


def _extract_via_chunked_download(dataset, traj_var, has_depth):
    """Fallback for servers without orderBy interval grouping: download only
    the id/position/time(/depth) columns in yearly chunks and bin locally."""
    frames = [
        _aggregate(df, traj_var, has_depth)
        for df in _iter_raw_chunks(dataset, traj_var, has_depth)
    ]

    if not frames:
        return pd.DataFrame()

    merged = pd.concat(frames, ignore_index=True)
    group_cols = ([traj_var] if traj_var else []) + ["latitude", "longitude"]
    agg = {
        "time_min": ("time_min", "min"),
        "time_max": ("time_max", "max"),
        "n_records": ("n_records", "sum"),
    }
    if has_depth:
        agg["depth_min"] = ("depth_min", "min")
        agg["depth_max"] = ("depth_max", "max")
    return merged.groupby(group_cols, dropna=False).agg(**agg).reset_index()


def _profiles_per_cell(dataset, traj_var, profile_var):
    """TrajectoryProfile: distinct profiles per cell.

    distinct() over (traj, profile, lat, lon) returns roughly one row per
    profile — bounded by profile count, not record count.
    """
    request_vars = [v for v in (traj_var, profile_var) if v] + ["latitude", "longitude"]
    df = dataset.dataset_tabledap_query(",".join(request_vars) + "&distinct()")
    if df.empty:
        return None
    df = df.dropna(subset=["latitude", "longitude"]).copy()
    df["latitude"] = _snap(df["latitude"])
    df["longitude"] = _snap(df["longitude"])
    if traj_var:
        df[traj_var] = df[traj_var].astype(str)
    group_cols = ([traj_var] if traj_var else []) + ["latitude", "longitude"]
    return (
        df.groupby(group_cols, dropna=False)
        .agg(n_profiles=(profile_var, "nunique"))
        .reset_index()
    )


def _first_fix_per_day(df, traj_var):
    """Reduce a raw [traj?, latitude, longitude, time] frame to the first fix
    of each (trajectory, UTC day). Expects `time` already parsed to datetime."""
    df = df.dropna(subset=["latitude", "longitude", "time"]).copy()
    if df.empty:
        return df
    if traj_var:
        df[traj_var] = df[traj_var].astype(str)
    group_cols = ([traj_var] if traj_var else []) + [df["time"].dt.floor("D")]
    return (
        df.sort_values("time")
        .groupby(group_cols, dropna=False, group_keys=False)
        .head(1)
    )


def _decimate_tracks(points, max_points=MAX_TRACK_POINTS_PER_TRAJECTORY):
    """Cap fixes per trajectory: keep an even stride plus the last fix.

    Expects points sorted by (trajectory_id, time).
    """

    def _cap(group):
        n = len(group)
        if n <= max_points:
            return group
        stride = -(-n // max_points)  # ceil
        kept = group.iloc[::stride]
        if kept.index[-1] != group.index[-1]:
            kept = pd.concat([kept, group.iloc[[-1]]])
        return kept

    return (
        points.groupby("trajectory_id", dropna=False, group_keys=False)
        .apply(_cap)
        .reset_index(drop=True)
    )


def extract_track_points(dataset, per_profile=False):
    """Ordered, downsampled RAW track fixes for one trajectory dataset.

    Returns a TrajectoryPointSchema-shaped frame (may be empty = no data):
    one row per retained fix — per-profile fixes for TrajectoryProfile
    (``per_profile=True``, full fidelity at Argo cadence), first-fix-per-day
    for plain Trajectory. Unlike extract_cells nothing is grid-snapped; these
    rows feed cde.trajectory_points for track-line rendering.

    Assumes extract_cells() already ran on this dataset (it populates
    dataset.trajectory_id_variable / profile_id_variable).
    """
    log = dataset.logger
    traj_var = dataset.trajectory_id_variable
    profile_var = dataset.profile_id_variable if per_profile else None

    points = pd.DataFrame()
    try:
        if profile_var:
            # One row per (trajectory, profile): the row holding each group's
            # min time, lat/lon included. Bounded by profile count (same bound
            # as _profiles_per_cell's distinct() query).
            request_vars = [v for v in (traj_var, profile_var) if v] + [
                "time", "latitude", "longitude",
            ]
            group = ",".join(v for v in (traj_var, profile_var) if v)
            url = ",".join(request_vars) + requests.utils.quote(
                f'&orderByMin("{group},time")'
            )
            points = dataset.dataset_tabledap_query(url)
        else:
            # First fix of each UTC day per trajectory, grouped server-side
            # (orderByMin with an interval on its target: min time within each
            # (traj, day) group, e.g. orderByMin("traj,time/1day")).
            request_vars = ([traj_var] if traj_var else []) + [
                "time", "latitude", "longitude",
            ]
            group = (f"{traj_var}," if traj_var else "") + f"time/{TRACK_INTERVAL}"
            url = ",".join(request_vars) + requests.utils.quote(
                f'&orderByMin("{group}")'
            )
            points = dataset.dataset_tabledap_query(url)
            if not points.empty:
                points["time"] = ERDDAP.parse_erddap_dates(points["time"])
                points = _first_fix_per_day(points, traj_var)
    except HTTPError:
        log.warning(
            "Server-side track-point grouping failed for %s; falling back to "
            "chunked download + local daily downsample", dataset.id,
        )
        points = pd.DataFrame()

    if points.empty:
        # Fallback: same yearly-chunked raw download the cell fallback uses,
        # reduced locally to first-fix-per-day (also for TrajectoryProfile —
        # a per-day track is an acceptable degradation when the server lacks
        # orderBy grouping).
        frames = []
        for df in _iter_raw_chunks(dataset, traj_var, has_depth=False):
            df = df.copy()
            df["time"] = ERDDAP.parse_erddap_dates(df["time"])
            reduced = _first_fix_per_day(df, traj_var)
            if not reduced.empty:
                frames.append(reduced)
        points = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()

    if points.empty:
        log.warning("No track points found for %s", dataset.id)
        return pd.DataFrame()

    if not pd.api.types.is_datetime64_any_dtype(points["time"]):
        points["time"] = ERDDAP.parse_erddap_dates(points["time"])
    points["latitude"] = pd.to_numeric(points["latitude"], errors="coerce")
    points["longitude"] = pd.to_numeric(points["longitude"], errors="coerce")
    points = points.dropna(subset=["time", "latitude", "longitude"])
    # Same validity filter as extract_cells — also drops Argo's 99.999 /
    # 999.999 bad-position sentinels.
    points = points.query(
        "latitude > -90 and latitude < 90 and longitude >= -180 and longitude <= 180"
    ).copy()
    if points.empty:
        log.warning("No valid track points remain for %s", dataset.id)
        return points

    points = points.rename(columns={traj_var: "trajectory_id"} if traj_var else {})
    if "trajectory_id" not in points:
        points["trajectory_id"] = ""
    points["trajectory_id"] = points["trajectory_id"].astype(str)
    if profile_var and profile_var in points:
        points = points.rename(columns={profile_var: "profile_id"})
        points["profile_id"] = points["profile_id"].astype(str)
    else:
        points["profile_id"] = None

    points = points.sort_values(["trajectory_id", "time"])
    # The UNIQUE key is (erddap_url, dataset_id, trajectory_id, time): two
    # profiles reported at an identical timestamp collapse to one fix.
    points = points.drop_duplicates(subset=["trajectory_id", "time"], keep="first")
    points = _decimate_tracks(points)

    points["dataset_id"] = dataset.id
    points["erddap_url"] = dataset.erddap_url
    points = points[
        ["erddap_url", "dataset_id", "trajectory_id", "profile_id",
         "time", "latitude", "longitude"]
    ]

    log.info(
        "Extracted %d track points across %d trajectories for %s",
        len(points), points["trajectory_id"].nunique(), dataset.id,
    )
    return points


def extract_cells(dataset, count_profiles=False):
    """Build the trajectory_cells DataFrame for one dataset.

    Returns a TrajectoryCellSchema-shaped frame (may be empty = no data).
    """
    log = dataset.logger

    # CF-role variables, without the profile pipeline's distinct(lat/lon)
    # query — that would return one row per GPS fix on a trajectory.
    df_variables = dataset.df_variables
    profile_variables = (
        df_variables.set_index("cf_role", drop=False)
        .query('cf_role != ""')[["cf_role", "name"]]["name"]
        .to_dict()
    )
    dataset.profile_variables = profile_variables
    dataset.profile_variable_list = sorted(profile_variables.values())
    dataset.timeseries_id_variable = profile_variables.get("timeseries_id")
    dataset.profile_id_variable = profile_variables.get("profile_id")
    dataset.trajectory_id_variable = profile_variables.get("trajectory_id")

    traj_var = dataset.trajectory_id_variable
    profile_var = dataset.profile_id_variable
    has_depth = "depth" in dataset.variables_list

    # Distinct trajectory list: cheap, and get_df() derives the dataset-level
    # n_profiles (number of deployments/missions) from it.
    if traj_var:
        trajectories = dataset.dataset_tabledap_query(f"{traj_var}&distinct()")
        dataset.profile_ids = trajectories
    else:
        log.warning("No cf_role=trajectory_id variable; treating dataset as one trajectory")
        trajectories = pd.DataFrame({"trajectory_id": [""]})
        dataset.profile_ids = trajectories

    try:
        cells = _extract_via_server_binning(dataset, traj_var, has_depth)
    except HTTPError:
        log.warning(
            "Server-side interval grouping failed for %s; falling back to "
            "chunked download + local binning", dataset.id,
        )
        cells = pd.DataFrame()

    if cells.empty:
        cells = _extract_via_chunked_download(dataset, traj_var, has_depth)

    if cells.empty:
        log.warning("No trajectory cells found for %s", dataset.id)
        return cells

    # Distinct profile count per cell (TrajectoryProfile only)
    if count_profiles and profile_var:
        group_cols = ([traj_var] if traj_var else []) + ["latitude", "longitude"]
        profile_counts = _profiles_per_cell(dataset, traj_var, profile_var)
        if profile_counts is not None:
            cells = cells.merge(profile_counts, on=group_cols, how="left")
    if "n_profiles" not in cells:
        cells["n_profiles"] = 0
    cells["n_profiles"] = cells["n_profiles"].fillna(0)

    # Normalize to the TrajectoryCellSchema contract
    cells = cells.rename(columns={traj_var: "trajectory_id"} if traj_var else {})
    if "trajectory_id" not in cells:
        cells["trajectory_id"] = ""
    if not has_depth or "depth_min" not in cells:
        cells["depth_min"] = 0
        cells["depth_max"] = 0
    cells["depth_min"] = cells["depth_min"].fillna(0)
    cells["depth_max"] = cells["depth_max"].fillna(0)

    cells["dataset_id"] = dataset.id
    cells["erddap_url"] = dataset.erddap_url

    # Drop cells with unusable extents or coordinates (mirrors the profile
    # pipeline's bad-geom filter).
    cells = cells.dropna(subset=["time_min", "time_max"])
    cells = cells.query(
        "latitude > -90 and latitude < 90 and longitude >= -180 and longitude <= 180"
    ).copy()
    if cells.empty:
        return cells

    # days + records_per_day feed tiles and the download-size estimator.
    # Match the profiles conventions exactly: the `days` column is
    # date_part('days', span) + 1 (see process_profile_geometry_and_links),
    # while records_per_day divides by the raw span floored to one day
    # (see the profile pipeline in tabledap_features).
    span_days = (cells["time_max"] - cells["time_min"]).dt.days
    cells["days"] = span_days + 1
    cells["records_per_day"] = cells["n_records"] / span_days.replace(0, 1)

    log.info(
        "Extracted %d trajectory cells across %d trajectories for %s",
        len(cells), cells["trajectory_id"].nunique(), dataset.id,
    )
    return cells
