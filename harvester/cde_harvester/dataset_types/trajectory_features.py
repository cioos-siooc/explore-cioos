"""Trajectory coverage extraction.

Trajectory / TrajectoryProfile datasets (gliders, drifters, ships underway)
have a moving position per record, so the one-lat/lon-per-feature profile
pipeline doesn't apply. The track is reduced to two outputs, and the database
combines them:

* ``extract_track_points`` — the ordered, downsampled fixes themselves
  (cde.trajectory_points). The database sweeps the segments between them
  through the hex grid (``trajectory_build_hexes``, database/4_create_hexes.sql),
  so the map lights every hex the platform CROSSED. This is the geometry.
* ``extract_day_stats`` — per (trajectory, UTC day) record counts and depth
  range (cde.trajectory_days). These are the attributes; the database
  apportions them across the hexes each day's track passed through.

Both reductions happen ON THE ERDDAP SERVER via orderBy* grouping with the
``variable/interval`` syntax (``orderByCount("traj,time/86400")``), so the
response size is the number of trajectory-days (KB), never the
full-resolution track. Servers whose ERDDAP predates interval grouping fall
back to downloading only the id/lat/lon/time/depth columns in monthly chunks
and reducing in pandas (bounded by MAX_RESPONSE_SIZE).

An earlier design asked the server to bin positions onto a 1/12-degree lat/lon
grid and lit the single hex containing each bin centre. In EPSG:3857 — where
the hex grid lives — 1/12 degree of latitude is 9.28 km / cos(lat) while a hex
row is a fixed 17.3 km, so north of ~57N whole hex rows along a track went
unlit. Sweeping the track itself has no such latitude dependence.
"""

import logging

import numpy as np
import pandas as pd
import requests
from requests.exceptions import HTTPError
from shapely.geometry import LineString

from cde_harvester.core.errors import ResponseTooLargeError
from cde_harvester.core.day_sets import bucket_index_to_day, day_bucket_group
from cde_harvester.sources.erddap.client import ERDDAP

logger = logging.getLogger(__name__)

# Track-point downsampling for plain Trajectory datasets (ships/drifters can
# report every few seconds, others every few days): start from a cheap
# one-fix-per-UTC-day probe (TRACK_DAY_SECONDS), then refine to a finer bucket
# sized so the CANDIDATE response stays under TRACK_CANDIDATE_BUDGET rows
# (~90 bytes/row -> ~27MB, comfortably under MAX_RESPONSE_SIZE), never coarser
# than a day and never finer than 10 minutes. The candidate set is
# deliberately oversampled relative to what's stored: time buckets are
# speed-blind (a coarse bucket on a fast ferry draws 50km chords across
# land), so shape fidelity comes from the Douglas-Peucker pass afterwards,
# which needs fine-grained input to have anything to work with. At 10-minute
# buckets a 20-knot vessel moves ~6km per retained fix — segments follow a
# coastal channel instead of cutting across it.
# Sizing off the probe's OWN row count (active trajectory-days) rather than a
# duration/count pulled from dataset metadata means a single corrupt timestamp
# far outside the real deployment window (seen in practice on a live C-PROOF
# glider dataset) adds one harmless extra "active day" instead of blowing up
# the chosen interval.
TRACK_DAY_SECONDS = 86400
TRACK_CANDIDATE_BUDGET = 300_000
TRACK_MIN_INTERVAL_SECONDS = 600
TRACK_MAX_INTERVAL_SECONDS = TRACK_DAY_SECONDS
# The raw-download fallback (servers without orderBy interval grouping) can't
# run the two-step probe — it reduces each monthly chunk locally at a fixed
# middle-ground bucket: fine enough for a usable line, bounded at
# month/1800s = ~1.5k rows per trajectory-month in memory.
TRACK_FALLBACK_INTERVAL_SECONDS = 1800

# Hard per-trajectory cap on retained fixes, sized to how many distinct UTC
# days that trajectory actually has data on — a 44-day deployment and a
# 708-day one shouldn't share one flat cap. Enforced by _decimate_tracks via
# shape-preserving (Douglas-Peucker) simplification first, falling back to an
# even stride only if DP alone doesn't fit under the cap.
# The cap also sets the RESOLUTION OF THE MAP COVERAGE, not just the smoothness
# of the drawn line: the database sweeps the segments between retained fixes
# through the hex grid, so a stride-decimated track under-reports the hexes it
# actually crossed. Sized for the worst case in the catalogue — a single
# 20-year ship trajectory — and cheap: the fixes are already downloaded (only
# local Douglas-Peucker retention changes) and the whole table is an order of
# magnitude smaller than the per-cell table this replaced.
TRACK_POINTS_PER_ACTIVE_DAY = 50
MIN_TRACK_POINTS_CAP = 1000
MAX_TRACK_POINTS_CAP = 60000
# Perpendicular-distance tolerance for the Douglas-Peucker simplification,
# applied in an equirectangular approximation (longitude scaled by
# cos(mean latitude)) so a single degree-space tolerance is roughly isotropic.
# 0.5km keeps a simplified line within half a kilometre of the true track —
# inside even the narrow reaches of a coastal shipping channel — while
# collapsing straight open-water legs and docked periods to their endpoints.
TRACK_SIMPLIFY_TOLERANCE_KM = 0.5
KM_PER_DEGREE_LATITUDE = 111.32
# After DP, re-add removed candidates so no retained-to-retained chord exceeds
# this. DP-created chords are verified (every dropped candidate lies within
# the tolerance of the chord) but at render time they'd be indistinguishable
# from a DATA OUTAGE chord, whose true path is unknown and can cross land.
# Keeping verified chords short makes "chord > ~2x this" a reliable outage
# signal for the render-side gap splitting (web-api /tiles/tracks, frontend
# splitTrackRuns), which is what stops outage chords being drawn.
TRACK_MAX_CHORD_KM = 25


def _day_group(traj_var):
    """orderBy* grouping clause: one group per (trajectory, UTC day)."""
    return day_bucket_group([traj_var] if traj_var else [])


def _bucket_index_to_day(series):
    """Turn an orderByCount interval-group column into the bucket's UTC day.

    Thin wrapper over the shared decoder so the ERDDAP date parser stays an
    argument there — see core/day_sets.py for what makes this necessary. The
    tabledap per-feature day count issues the same kind of query and shares the
    same trap.
    """
    return bucket_index_to_day(series, ERDDAP.parse_erddap_dates)


def _day_counts(dataset, traj_var):
    """Records per (trajectory, day) via server-side orderByCount.

    `latitude` is the counted column (`time` can't be: it is the group-by
    column). Counting positions rather than every row is also the honest number
    for a coverage layer whose geometry is positions.
    """
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


def _day_depths(dataset, traj_var):
    """Depth range per (trajectory, day) via server-side orderByMinMax.

    Two rows per group (the min row and the max row); collapsed by the caller.
    """
    request_vars = ([traj_var] if traj_var else []) + ["time", "depth"]
    url = ",".join(request_vars) + requests.utils.quote(
        f'&orderByMinMax("{_day_group(traj_var)},depth")'
    )
    return dataset.dataset_tabledap_query(url)


def _to_days(df, traj_var):
    """Add a UTC `day` column from a parsed/parseable `time` column."""
    df = df.dropna(subset=["time"]).copy()
    if df.empty:
        return df
    if not pd.api.types.is_datetime64_any_dtype(df["time"]):
        df["time"] = ERDDAP.parse_erddap_dates(df["time"])
    df = df.dropna(subset=["time"])
    df["day"] = df["time"].dt.floor("D")
    if traj_var:
        df[traj_var] = df[traj_var].astype(str)
    return df


def _iter_raw_chunks(dataset, traj_var, has_depth):
    """Yield raw [traj?, latitude, longitude, time(, depth)] frames in monthly
    chunks — the shared download loop for both fallback paths (cell binning
    and track-point downsampling), only exercised when a server lacks orderBy
    interval grouping entirely. A year-wide window can itself exceed
    MAX_RESPONSE_SIZE for a high-frequency trajectory (seen in practice: a 1Hz
    glider's full download is ~330MB against a 200MB cap); monthly chunks
    bound that far more reliably. Each chunk is bounded by MAX_RESPONSE_SIZE;
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
        # Monthly chunk starts, plus a final bound past the end so a dataset
        # shorter than one chunk still yields exactly one query.
        bounds = list(
            pd.date_range(start.floor("D"), end.ceil("D"), freq=pd.DateOffset(months=1))
        )
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


def _day_stats_via_chunked_download(dataset, traj_var, has_depth):
    """Fallback for servers without orderBy interval grouping: download only
    the id/position/time(/depth) columns in monthly chunks and reduce each
    chunk to per-day rows locally."""
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
    """TrajectoryProfile: one row per (trajectory, profile) — the fix at the
    profile's first sample, via orderByMin.

    NOT distinct() over (traj, profile, lat, lon): position varies within a
    profile whenever the platform interpolates lat/lon per sample (all glider
    datasets checked), so distinct() returns ~one row per SAMPLE — seen live at
    255MB against the 200MB response cap, failing the whole dataset.

    Cached on the dataset: extract_day_stats counts profiles per day from it
    and extract_track_points draws the track from it, and one request has to
    serve both.
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
    """Reduce a raw [traj?, latitude, longitude, time] frame to the first fix
    within each (trajectory, time-bucket) of the given size, in seconds.
    Expects `time` already parsed to datetime. Bucket boundaries are aligned
    to the UTC epoch, so interval_seconds=TRACK_DAY_SECONDS reproduces
    UTC-midnight-aligned daily buckets."""
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


def _first_fix_per_day(df, traj_var):
    """Reduce a raw [traj?, latitude, longitude, time] frame to the first fix
    of each (trajectory, UTC day). Expects `time` already parsed to datetime."""
    return _first_fix_per_interval(df, traj_var, TRACK_DAY_SECONDS)


def _choose_track_interval_seconds(n_active_groups):
    """Pick a finer bucket size (seconds) from how many (trajectory, day)
    groups a cheap day-level probe already found — not from a dataset-level
    duration, which a single corrupt out-of-range timestamp can blow up to
    years (seen in practice). Worst-case candidate rows are
    n_active_groups * (day / interval), so interval =
    n_active_groups * day / TRACK_CANDIDATE_BUDGET bounds the response;
    clamped so we never go coarser than a day (no regression vs. the old
    fixed behavior) or finer than TRACK_MIN_INTERVAL_SECONDS. The candidate
    set is intentionally dense — the Douglas-Peucker pass in
    _decimate_tracks, not the bucket size, decides what is finally kept."""
    if n_active_groups <= 0:
        return TRACK_MAX_INTERVAL_SECONDS
    raw = (n_active_groups * TRACK_DAY_SECONDS) / TRACK_CANDIDATE_BUDGET
    return int(round(min(max(raw, TRACK_MIN_INTERVAL_SECONDS), TRACK_MAX_INTERVAL_SECONDS)))


def _cap_for_active_days(n_active_days):
    """Scale the per-trajectory point cap with how many distinct UTC days
    that trajectory actually has data on, clamped to
    [MIN_TRACK_POINTS_CAP, MAX_TRACK_POINTS_CAP] -- a 44-day deployment and a
    708-day one shouldn't share one flat cap."""
    return int(
        min(max(n_active_days * TRACK_POINTS_PER_ACTIVE_DAY, MIN_TRACK_POINTS_CAP),
            MAX_TRACK_POINTS_CAP)
    )


def _simplify_shape(group, tolerance_km=TRACK_SIMPLIFY_TOLERANCE_KM):
    """Douglas-Peucker simplification (via shapely/GEOS) of one trajectory's
    ordered fixes -- keeps turning points (e.g. a ferry's repeated
    back-and-forth) instead of blindly striding. Longitude is scaled by
    cos(mean latitude) before simplifying so a single degree-space tolerance
    is roughly isotropic in km; unscaled after. Always keeps both endpoints.
    """
    if len(group) < 3:
        return group

    lat = group["latitude"].to_numpy()
    lon = group["longitude"].to_numpy()
    lon_scale = np.cos(np.radians(lat.mean()))
    scaled_lon = lon * lon_scale
    tolerance_deg = tolerance_km / KM_PER_DEGREE_LATITUDE

    line = LineString(np.column_stack([scaled_lon, lat]))
    simplified_coords = list(line.simplify(tolerance_deg, preserve_topology=False).coords)

    # GEOS simplify only ever drops vertices (never moves or adds them), so a
    # positional two-pointer scan against the original, ordered coordinates
    # recovers which ORIGINAL rows were kept. A set/isin match would
    # mis-handle two different rows sharing an identical fix (e.g. a vessel
    # idling at dock reporting the same position repeatedly).
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
    """Vectorized great-circle distance in km between coordinate arrays."""
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp = p2 - p1
    dl = np.radians(lon2 - lon1)
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * 6371.0 * np.arcsin(np.sqrt(a))


def _densify_long_chords(group, kept, max_chord_km=TRACK_MAX_CHORD_KM):
    """Re-add candidates DP removed so no retained chord exceeds max_chord_km.

    ``group`` is the pre-DP candidate frame, ``kept`` the DP output (a row
    subset of it, order preserved). The re-added rows sit within the DP
    tolerance of the chord — the line barely changes — but they mark the
    chord as data-backed, so the render-side gap splitting can treat any
    remaining long chord as a data outage and break the line there instead
    of drawing it.
    """
    if len(kept) < 2:
        return kept
    pos = group.index.get_indexer(kept.index)
    lat = group["latitude"].to_numpy()
    lon = group["longitude"].to_numpy()
    chords = _haversine_km(
        lat[pos[:-1]], lon[pos[:-1]], lat[pos[1:]], lon[pos[1:]]
    )
    out_positions = [pos[0]]
    for a, b, chord in zip(pos[:-1], pos[1:], chords):
        if chord > max_chord_km and b - a > 1:
            n_segments = int(np.ceil(chord / max_chord_km))
            inner = np.unique(
                np.linspace(a, b, min(n_segments, b - a) + 1).round().astype(int)
            )[1:-1]
            out_positions.extend(inner.tolist())
        out_positions.append(b)
    return group.iloc[sorted(set(out_positions))]


def _decimate_tracks(points, max_points=None, always_simplify=False):
    """Cap fixes per trajectory: shape-preserving (Douglas-Peucker) first,
    falling back to an even stride (keeping first/last) only if DP alone
    doesn't fit under the cap -- DP is deviation-bound, not count-bound, so a
    very convoluted route can still overshoot a small cap.

    ``always_simplify=True`` (the binned plain-Trajectory path) runs DP even
    under the cap: the candidate set is deliberately oversampled time buckets
    (speed-blind), so DP is what strips docked/idle repeats and straight-leg
    redundancy. Per-profile candidates keep their one-row-per-profile
    semantics unless the cap forces simplification.

    Expects points sorted by (trajectory_id, time). When max_points is None
    (the normal path) the cap is chosen per trajectory from how many distinct
    UTC days it actually has data on (_cap_for_active_days); passing an
    explicit max_points overrides that for every trajectory (used by tests).
    """

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
            stride = -(-n // cap)  # ceil
            kept = simplified.iloc[::stride]
            if kept.index[-1] != simplified.index[-1]:
                kept = pd.concat([kept, simplified.iloc[[-1]]])
            simplified = kept
        # Densify LAST, so the <=TRACK_MAX_CHORD_KM chord guarantee is
        # unconditional — the stride fallback would otherwise recreate long
        # data-backed chords that the render-side outage splitting would
        # wrongly sever. The cap is soft against densification: the overshoot
        # is bounded by route length / TRACK_MAX_CHORD_KM, not by fix count.
        return _densify_long_chords(group, simplified)

    return (
        # reset_index: _densify_long_chords maps DP survivors back to
        # candidate rows positionally, which needs a unique index (the
        # fallback path concatenates monthly frames with repeating indices).
        points.reset_index(drop=True)
        .groupby("trajectory_id", dropna=False, group_keys=False)
        .apply(_cap)
        .reset_index(drop=True)
    )


def extract_track_points(dataset, per_profile=False):
    """Ordered, downsampled RAW track fixes for one trajectory dataset.

    Returns a TrajectoryPointSchema-shaped frame (may be empty = no data):
    one row per retained fix — per-profile fixes for TrajectoryProfile
    (``per_profile=True``, full fidelity at Argo cadence); for plain
    Trajectory an adaptive time-bucket candidate set reduced by
    Douglas-Peucker simplification (see _choose_track_interval_seconds /
    _decimate_tracks). Nothing is snapped or aggregated: these rows feed
    cde.trajectory_points, which the database both draws as track lines and
    sweeps through the hex grid to build the coverage layer — so how much of
    the track survives _decimate_tracks is how much of the map lights up.

    Assumes extract_day_stats() already ran on this dataset (it populates
    dataset.trajectory_id_variable / profile_id_variable).
    """
    log = dataset.logger
    traj_var = dataset.trajectory_id_variable
    profile_var = dataset.profile_id_variable if per_profile else None

    points = pd.DataFrame()
    try:
        if profile_var:
            # One row per (trajectory, profile): the row holding each group's
            # min time, lat/lon included. Bounded by profile count, and already
            # fetched by extract_day_stats (which counts profiles per day from
            # the same frame) — _profile_fixes serves both from one request.
            points = _profile_fixes(dataset, traj_var, profile_var)
        else:
            # Two-step adaptive downsample, both fully server-side (never a
            # local full-resolution download): first probe at one-fix-per-
            # UTC-day (cheap, response size bounded regardless of reporting
            # cadence); its OWN row count -- active trajectory-days -- sizes a
            # second, finer bucket query so the candidate set stays near
            # TRACK_TARGET_POINTS whether the platform reports every second
            # or every few days. Sizing off the probe's row count rather than
            # a dataset-metadata duration means one corrupt out-of-range
            # timestamp (seen in practice) can't blow up the chosen interval.
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

            points = _query_at_interval(TRACK_DAY_SECONDS)
            if not points.empty:
                points["time"] = ERDDAP.parse_erddap_dates(points["time"])
                points = _first_fix_per_day(points, traj_var)

                finer_interval = _choose_track_interval_seconds(len(points))
                if finer_interval < TRACK_DAY_SECONDS:
                    try:
                        finer_points = _query_at_interval(finer_interval)
                    except HTTPError:
                        finer_points = pd.DataFrame()
                    if not finer_points.empty:
                        finer_points["time"] = ERDDAP.parse_erddap_dates(finer_points["time"])
                        points = _first_fix_per_interval(finer_points, traj_var, finer_interval)
    except HTTPError:
        log.warning(
            "Server-side track-point grouping failed for %s; falling back to "
            "chunked download + local daily downsample", dataset.id,
        )
        points = pd.DataFrame()

    if points.empty:
        # Fallback: same monthly-chunked raw download the day-stats fallback uses,
        # reduced locally to first-fix-per-half-hour (also for
        # TrajectoryProfile — a fixed-bucket track is an acceptable
        # degradation when the server lacks orderBy grouping). The two-step
        # probe can't run here (each chunk is discarded after reduction), so
        # a fixed middle-ground bucket bounds memory at ~1.5k rows per
        # trajectory-month while staying fine enough for a usable line;
        # _decimate_tracks does the rest.
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
    # Same validity filter as extract_day_stats — also drops Argo's 99.999 /
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
    # Binned candidates are deliberately oversampled and speed-blind — DP
    # always runs on them to recover shape economy. Per-profile rows keep
    # their one-fix-per-profile semantics unless the cap forces it.
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
    """Build the trajectory_days DataFrame for one dataset.

    One row per (trajectory, UTC day): records observed and depth range.
    Deliberately position-free — where the platform was that day comes from
    extract_track_points, and the database joins the two by day.

    Returns a TrajectoryDaySchema-shaped frame (may be empty = no data).
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

    if days.empty:
        days = _day_stats_via_chunked_download(dataset, traj_var, has_depth)
    elif has_depth:
        # Best-effort, like the profile count below: a dataset whose counts
        # succeeded must not fail because its depth query was too large.
        try:
            depths = _to_days(_day_depths(dataset, traj_var), traj_var)
        except (HTTPError, ResponseTooLargeError):
            log.warning("Per-day depth range failed for %s", dataset.id, exc_info=True)
            depths = pd.DataFrame()
        if not depths.empty:
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

    # Distinct profiles per day (TrajectoryProfile only), counted from the
    # per-profile fixes extract_track_points draws the track from — no request
    # of its own. Best-effort: a failed enhancement must not fail a dataset
    # whose days succeeded (a too-large response here took out a whole glider
    # dataset in production).
    if count_profiles and profile_var:
        try:
            fixes = _to_days(_profile_fixes(dataset, traj_var, profile_var), traj_var)
        except (HTTPError, ResponseTooLargeError):
            log.warning(
                "Per-day profile count failed for %s; keeping days without "
                "n_profiles", dataset.id, exc_info=True,
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

    # Normalize to the TrajectoryDaySchema contract
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
