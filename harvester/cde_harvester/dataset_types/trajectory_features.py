"""Trajectory coverage extraction.

Two outputs: ``extract_track_points`` (the downsampled fixes the database
sweeps through the hex grid — the geometry) and ``extract_day_stats`` (per
trajectory-day counts and depth range — the attributes). Both reduce ON THE
ERDDAP SERVER via orderBy interval grouping; older servers fall back to monthly
chunked downloads reduced in pandas.

The track is swept rather than binned server-side onto a lat/lon grid: a
1/12-degree bin shrinks with latitude in EPSG:3857 while hex rows don't, so
north of ~57N binning left whole hex rows along a track unlit.
"""

import logging

import numpy as np
import pandas as pd
import requests
from requests.exceptions import HTTPError
from shapely.geometry import LineString

from cde_harvester.core.day_sets import bucket_index_to_day, day_bucket_group
from cde_harvester.core.errors import ResponseTooLargeError
from cde_harvester.core.harvest_warnings import (
    DEPTH_RANGE_UNAVAILABLE,
    PROFILE_COUNT_UNAVAILABLE,
    TRAJECTORY_DATA_INCOMPLETE,
)
from cde_harvester.sources.erddap.client import ERDDAP

logger = logging.getLogger(__name__)

# Plain-Trajectory bucket size comes from the active trajectory-day count so the
# candidate response stays under TRACK_CANDIDATE_BUDGET rows (~27MB). Candidates
# are deliberately oversampled: time buckets are speed-blind (a coarse bucket on
# a fast ferry draws 50km chords across land), so shape comes from the
# Douglas-Peucker pass. The day count, unlike a metadata duration, can't be
# blown up by one corrupt out-of-range timestamp (seen on a C-PROOF glider).
TRACK_DAY_SECONDS = 86400
TRACK_CANDIDATE_BUDGET = 300_000
TRACK_MIN_INTERVAL_SECONDS = 600
TRACK_MAX_INTERVAL_SECONDS = TRACK_DAY_SECONDS
# Raw-download fallback bucket: ~1.5k rows per trajectory-month in memory.
TRACK_FALLBACK_INTERVAL_SECONDS = 1800

# Per-trajectory cap on retained fixes, scaled by active days. The cap also sets
# the RESOLUTION OF THE MAP COVERAGE: the database sweeps segments between fixes
# through the hex grid, so a stride-decimated track under-reports crossed hexes.
# MAX is sized for the worst case in the catalogue, a 20-year ship trajectory.
TRACK_POINTS_PER_ACTIVE_DAY = 50
MIN_TRACK_POINTS_CAP = 1000
MAX_TRACK_POINTS_CAP = 60000
# Keeps a simplified line inside even the narrow reaches of a coastal channel.
TRACK_SIMPLIFY_TOLERANCE_KM = 0.5
KM_PER_DEGREE_LATITUDE = 111.32
# No retained chord exceeds this, so a longer one reliably signals a DATA OUTAGE
# to the render-side gap splitting (web-api /tiles/tracks, frontend
# splitTrackRuns), which then stops drawing it across land.
TRACK_MAX_CHORD_KM = 25


def _day_group(traj_var):
    return day_bucket_group([traj_var] if traj_var else [])


def _bucket_index_to_day(series):
    return bucket_index_to_day(series, ERDDAP.parse_erddap_dates)


def _day_counts(dataset, traj_var):
    """`latitude` is counted because `time` is the group-by column."""
    request_vars = ([traj_var] if traj_var else []) + ["time", "latitude"]
    url = ",".join(request_vars) + requests.utils.quote(
        f'&orderByCount("{_day_group(traj_var)}")'
    )
    df = dataset.dataset_tabledap_query(url)
    if df.empty:
        return df
    df = df.rename(columns={"latitude": "n_records"})
    df["day"] = _bucket_index_to_day(df["time"])
    if traj_var:
        df[traj_var] = df[traj_var].astype(str)
    return df.dropna(subset=["day"])


def _constant_depth(dataset):
    """e.g. a ship's fixed intake depth: the per-day depth query would only
    repeat it."""
    try:
        actual_range = dataset.df_variables.loc["depth", "actual_range"]
        lo, hi = (float(v) for v in actual_range.split(","))
    except (KeyError, AttributeError, ValueError):
        return None
    return lo if lo == hi else None


def _day_depths(dataset, traj_var):
    """Two rows per group (min and max); collapsed by the caller."""
    request_vars = ([traj_var] if traj_var else []) + ["time", "depth"]
    url = ",".join(request_vars) + requests.utils.quote(
        f'&orderByMinMax("{_day_group(traj_var)},depth")'
    )
    return dataset.dataset_tabledap_query(url)


def _to_days(df, traj_var):
    # erddap_csv_to_df answers ERDDAP's no-data 404 with a column-less frame.
    if df.empty:
        return df
    df = df.dropna(subset=["time"]).copy()
    if not pd.api.types.is_datetime64_any_dtype(df["time"]):
        df["time"] = ERDDAP.parse_erddap_dates(df["time"])
    df = df.dropna(subset=["time"])
    df["day"] = df["time"].dt.floor("D")
    if traj_var:
        df[traj_var] = df[traj_var].astype(str)
    return df


def _iter_raw_chunks(dataset, traj_var, has_depth):
    """Monthly chunks: a 1Hz glider's year-wide download was ~330MB against the
    200MB response cap. Failed chunks are skipped."""
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
        chunks = [""]
    else:
        # The final bound past the end makes a dataset shorter than one chunk
        # still yield exactly one query.
        bounds = list(
            pd.date_range(start.floor("D"), end.ceil("D"), freq=pd.DateOffset(months=1))
        )
        bounds.append(end.ceil("D") + pd.Timedelta(days=1))
        chunks = [
            f"&time>={a.strftime('%Y-%m-%dT%H:%M:%SZ')}&time<{b.strftime('%Y-%m-%dT%H:%M:%SZ')}"
            for a, b in zip(bounds[:-1], bounds[1:], strict=True)
        ]

    for time_query in chunks:
        try:
            df = dataset.dataset_tabledap_query(columns + time_query)
        except HTTPError as e:
            dataset.warnings.add(
                TRAJECTORY_DATA_INCOMPLETE,
                "Chunked trajectory download skipped time window(s) after an "
                "HTTP error",
                items=[f"{time_query} ({e})"],
                count=1,
            )
            continue
        if df.empty:
            continue
        yield df


def _day_stats_via_chunked_download(dataset, traj_var, has_depth):
    frames = []
    for df in _iter_raw_chunks(dataset, traj_var, has_depth):
        df = _to_days(df, traj_var)
        if df.empty:
            continue
        group_cols = ([traj_var] if traj_var else []) + ["day"]
        agg = {"n_records": ("latitude", "count")}
        if has_depth:
            df["depth"] = pd.to_numeric(df["depth"], errors="coerce")
            agg["depth_min"] = ("depth", "min")
            agg["depth_max"] = ("depth", "max")
        frames.append(df.groupby(group_cols, dropna=False).agg(**agg).reset_index())

    if not frames:
        return pd.DataFrame()

    merged = pd.concat(frames, ignore_index=True)
    group_cols = ([traj_var] if traj_var else []) + ["day"]
    agg = {"n_records": ("n_records", "sum")}
    if has_depth:
        agg["depth_min"] = ("depth_min", "min")
        agg["depth_max"] = ("depth_max", "max")
    return merged.groupby(group_cols, dropna=False).agg(**agg).reset_index()


def _profile_fixes(dataset, traj_var, profile_var):
    """The fix at each profile's first sample, via orderByMin.

    NOT distinct() over (traj, profile, lat, lon): gliders interpolate lat/lon
    per sample, so distinct() returns ~one row per SAMPLE (seen at 255MB against
    the 200MB cap). Cached so extract_day_stats and extract_track_points share
    one request.
    """
    cached = getattr(dataset, "_trajectory_profile_fixes", None)
    if cached is not None:
        return cached
    request_vars = [v for v in (traj_var, profile_var) if v] + [
        "time", "latitude", "longitude",
    ]
    group = ",".join(v for v in (traj_var, profile_var) if v)
    df = dataset.dataset_tabledap_query(
        ",".join(request_vars)
        + requests.utils.quote(f'&orderByMin("{group},time")')
    )
    dataset._trajectory_profile_fixes = df
    return df


def _first_fix_per_interval(df, traj_var, interval_seconds):
    """Expects parsed `time`; buckets are epoch-aligned, so TRACK_DAY_SECONDS
    gives UTC-midnight days."""
    df = df.dropna(subset=["latitude", "longitude", "time"]).copy()
    if df.empty:
        return df
    if traj_var:
        df[traj_var] = df[traj_var].astype(str)
    epoch_seconds = df["time"].astype("int64") // 10**9
    bucket = (epoch_seconds // interval_seconds) * interval_seconds
    group_cols = ([traj_var] if traj_var else []) + [bucket]
    return (
        df.sort_values("time")
        .groupby(group_cols, dropna=False, group_keys=False)
        .head(1)
    )


def _choose_track_interval_seconds(n_active_groups):
    """Worst-case candidate rows are n_active_groups * (day / interval)."""
    if n_active_groups <= 0:
        return TRACK_MAX_INTERVAL_SECONDS
    raw = (n_active_groups * TRACK_DAY_SECONDS) / TRACK_CANDIDATE_BUDGET
    return int(round(min(max(raw, TRACK_MIN_INTERVAL_SECONDS), TRACK_MAX_INTERVAL_SECONDS)))


def _cap_for_active_days(n_active_days):
    return int(
        min(max(n_active_days * TRACK_POINTS_PER_ACTIVE_DAY, MIN_TRACK_POINTS_CAP),
            MAX_TRACK_POINTS_CAP)
    )


def _simplify_shape(group, tolerance_km=TRACK_SIMPLIFY_TOLERANCE_KM):
    """Longitude is scaled by cos(mean latitude) so one degree-space tolerance
    is roughly isotropic in km."""
    if len(group) < 3:
        return group

    lat = group["latitude"].to_numpy()
    lon = group["longitude"].to_numpy()
    lon_scale = np.cos(np.radians(lat.mean()))
    scaled_lon = lon * lon_scale
    tolerance_deg = tolerance_km / KM_PER_DEGREE_LATITUDE

    line = LineString(np.column_stack([scaled_lon, lat]))
    simplified_coords = list(line.simplify(tolerance_deg, preserve_topology=False).coords)

    # GEOS simplify only drops vertices, so a positional scan recovers the kept
    # rows; a set/isin match would mis-handle repeated identical fixes (a
    # vessel idling at dock).
    kept_positions = []
    j = 0
    n_simplified = len(simplified_coords)
    for i in range(len(group)):
        if j >= n_simplified:
            break
        sx, sy = simplified_coords[j]
        if abs(scaled_lon[i] - sx) < 1e-9 and abs(lat[i] - sy) < 1e-9:
            kept_positions.append(i)
            j += 1
    return group.iloc[kept_positions]


def _haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp = p2 - p1
    dl = np.radians(lon2 - lon1)
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * 6371.0 * np.arcsin(np.sqrt(a))


def _densify_long_chords(group, kept, max_chord_km=TRACK_MAX_CHORD_KM):
    """Re-add candidates DP removed so no retained chord exceeds max_chord_km;
    ``kept`` is an order-preserving row subset of ``group``."""
    if len(kept) < 2:
        return kept
    pos = group.index.get_indexer(kept.index)
    lat = group["latitude"].to_numpy()
    lon = group["longitude"].to_numpy()
    chords = _haversine_km(
        lat[pos[:-1]], lon[pos[:-1]], lat[pos[1:]], lon[pos[1:]]
    )
    out_positions = [pos[0]]
    for a, b, chord in zip(pos[:-1], pos[1:], chords, strict=True):
        if chord > max_chord_km and b - a > 1:
            n_segments = int(np.ceil(chord / max_chord_km))
            inner = np.unique(
                np.linspace(a, b, min(n_segments, b - a) + 1).round().astype(int)
            )[1:-1]
            out_positions.extend(inner.tolist())
        out_positions.append(b)
    return group.iloc[sorted(set(out_positions))]


def _decimate_tracks(points, max_points=None, always_simplify=False):
    """Douglas-Peucker first, then an even stride if DP (deviation-bound, not
    count-bound) still overshoots the cap. Expects points sorted by
    (trajectory_id, time)."""

    def _cap(group):
        cap = max_points
        if cap is None:
            n_active_days = group["time"].dt.floor("D").nunique()
            cap = _cap_for_active_days(n_active_days)
        if len(group) <= cap and not always_simplify:
            return group

        simplified = _simplify_shape(group)
        if len(simplified) > cap:
            n = len(simplified)
            stride = -(-n // cap)
            kept = simplified.iloc[::stride]
            if kept.index[-1] != simplified.index[-1]:
                kept = pd.concat([kept, simplified.iloc[[-1]]])
            simplified = kept
        # Densify LAST so the chord guarantee survives the stride fallback; the
        # cap is soft against it (overshoot <= route length / max chord).
        return _densify_long_chords(group, simplified)

    return (
        # _densify_long_chords maps rows positionally and needs a unique index;
        # the fallback path concatenates frames with repeating indices.
        points.reset_index(drop=True)
        .groupby("trajectory_id", dropna=False, group_keys=False)
        .apply(_cap)
        .reset_index(drop=True)
    )


def extract_track_points(dataset, per_profile=False):
    """Assumes extract_day_stats() already ran: it sets the cf_role variables
    and the active trajectory-day count that sizes the bucket."""
    log = dataset.logger
    traj_var = dataset.trajectory_id_variable
    profile_var = dataset.profile_id_variable if per_profile else None

    points = pd.DataFrame()
    try:
        if profile_var:
            points = _profile_fixes(dataset, traj_var, profile_var)
        else:
            # ERDDAP requires the min target as an explicit trailing variable
            # -- omitting it (e.g. orderByMin("traj,time/86400") alone) 404s
            # on every server tested (2.19-2.28), hence the trailing ",time".
            request_vars = ([traj_var] if traj_var else []) + [
                "time", "latitude", "longitude",
            ]
            group_prefix = f"{traj_var}," if traj_var else ""

            def _query_at_interval(interval_seconds):
                url = ",".join(request_vars) + requests.utils.quote(
                    f'&orderByMin("{group_prefix}time/{interval_seconds},time")'
                )
                return dataset.dataset_tabledap_query(url)

            interval = _choose_track_interval_seconds(
                getattr(dataset, "_trajectory_day_count", 0)
            )
            try:
                points = _query_at_interval(interval)
            except HTTPError:
                if interval == TRACK_DAY_SECONDS:
                    raise
                # A fine bucket is the expensive query; daily fixes still
                # draw a usable track.
                interval = TRACK_DAY_SECONDS
                points = _query_at_interval(interval)
            if not points.empty:
                points["time"] = ERDDAP.parse_erddap_dates(points["time"])
                points = _first_fix_per_interval(points, traj_var, interval)
    except HTTPError:
        log.warning(
            "Server-side track-point grouping failed for %s; falling back to "
            "chunked download + local daily downsample", dataset.id,
        )
        points = pd.DataFrame()

    if points.empty:
        # Also used for TrajectoryProfile: a fixed-bucket track is an
        # acceptable degradation when the server lacks orderBy grouping.
        frames = []
        for df in _iter_raw_chunks(dataset, traj_var, has_depth=False):
            df = df.copy()
            df["time"] = ERDDAP.parse_erddap_dates(df["time"])
            reduced = _first_fix_per_interval(
                df, traj_var, TRACK_FALLBACK_INTERVAL_SECONDS
            )
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
    # Also drops Argo's 99.999 / 999.999 bad-position sentinels.
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
    points = _decimate_tracks(points, always_simplify=not profile_var)

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


def extract_day_stats(dataset, count_profiles=False):
    """Deliberately position-free: the database joins track points by day."""
    log = dataset.logger

    # Not the profile pipeline's distinct(lat/lon): one row per GPS fix here.
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

    if not traj_var:
        log.warning("No cf_role=trajectory_id variable; treating dataset as one trajectory")

    group_cols = ([traj_var] if traj_var else []) + ["day"]

    try:
        days = _day_counts(dataset, traj_var)
        if not days.empty:
            days["n_records"] = pd.to_numeric(days["n_records"], errors="coerce")
            days = (
                days.groupby(group_cols, dropna=False)
                .agg(n_records=("n_records", "sum"))
                .reset_index()
            )
    except HTTPError:
        log.warning(
            "Server-side day grouping failed for %s; falling back to "
            "chunked download + local reduction", dataset.id,
        )
        days = pd.DataFrame()

    constant_depth = _constant_depth(dataset) if has_depth else None
    if days.empty:
        days = _day_stats_via_chunked_download(dataset, traj_var, has_depth)
    elif constant_depth is not None:
        days["depth_min"] = constant_depth
        days["depth_max"] = constant_depth
    elif has_depth:
        # Best-effort: a too-large depth query must not fail the dataset.
        try:
            depths = _to_days(_day_depths(dataset, traj_var), traj_var)
        except (HTTPError, ResponseTooLargeError) as e:
            dataset.warnings.add(
                DEPTH_RANGE_UNAVAILABLE,
                f"Per-day depth range query failed ({type(e).__name__}: {e}); "
                "days kept at depth 0",
            )
            depths = None
        if depths is not None and depths.empty:
            dataset.warnings.add(
                DEPTH_RANGE_UNAVAILABLE,
                "Per-day depth range query returned no values (all-NaN depth?); "
                "days kept at depth 0",
            )
        if depths is not None and not depths.empty:
            depths["depth"] = pd.to_numeric(depths["depth"], errors="coerce")
            depths = (
                depths.groupby(group_cols, dropna=False)
                .agg(depth_min=("depth", "min"), depth_max=("depth", "max"))
                .reset_index()
            )
            days = days.merge(depths, on=group_cols, how="left")

    if days.empty:
        log.warning("No trajectory days found for %s", dataset.id)
        return days

    # Read by get_df() (n_profiles = missions) and extract_track_points.
    dataset.profile_ids = (
        days[[traj_var]].drop_duplicates() if traj_var
        else pd.DataFrame({"trajectory_id": [""]})
    )
    dataset._trajectory_day_count = len(days)

    # Best-effort: a too-large response here once took out a whole glider
    # dataset in production.
    if count_profiles and profile_var:
        try:
            fixes = _to_days(_profile_fixes(dataset, traj_var, profile_var), traj_var)
        except (HTTPError, ResponseTooLargeError) as e:
            dataset.warnings.add(
                PROFILE_COUNT_UNAVAILABLE,
                f"Per-day profile count failed ({type(e).__name__}: {e}); "
                "days kept without n_profiles",
            )
            fixes = pd.DataFrame()
        if not fixes.empty:
            profile_counts = (
                fixes.groupby(group_cols, dropna=False)
                .agg(n_profiles=(profile_var, "nunique"))
                .reset_index()
            )
            days = days.merge(profile_counts, on=group_cols, how="left")
    if "n_profiles" not in days:
        days["n_profiles"] = 0
    days["n_profiles"] = days["n_profiles"].fillna(0)

    if not has_depth or "depth_min" not in days:
        days["depth_min"] = 0
        days["depth_max"] = 0
    days["depth_min"] = days["depth_min"].fillna(0)
    days["depth_max"] = days["depth_max"].fillna(0)

    days = days.rename(columns={traj_var: "trajectory_id"} if traj_var else {})
    if "trajectory_id" not in days:
        days["trajectory_id"] = ""
    days["trajectory_id"] = days["trajectory_id"].astype(str)
    days["dataset_id"] = dataset.id
    days["erddap_url"] = dataset.erddap_url
    days = days.dropna(subset=["day"])

    log.info(
        "Extracted %d trajectory days across %d trajectories for %s",
        len(days), days["trajectory_id"].nunique(), dataset.id,
    )
    return days[
        ["erddap_url", "dataset_id", "trajectory_id", "day",
         "n_records", "n_profiles", "depth_min", "depth_max"]
    ]
