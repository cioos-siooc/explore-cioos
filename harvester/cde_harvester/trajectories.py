#!/usr/bin/env python3
"""Trajectory (and TrajectoryProfile) extraction for ERDDAP datasets.

A trajectory dataset (glider, cruise, drifter, animal tag) is a *path*: one
trajectory_id traces thousands–millions of (time, lat, lon) points. Storing
every point is infeasible at the ~100k-trajectory / 1Hz scale we target, so we:

  * fire ONE decimated query per DATASET (all trajectories at once) using
    ERDDAP's server-side orderByClosest("traj_id,time/<interval>"), which
    returns roughly one point per trajectory per time bin — the native sample
    rate stops mattering;
  * if the response is too large, COARSEN the interval (double it) and retry,
    down to a vertex floor, before giving up on the line;
  * build one coarse MultiLineString per trajectory and hand it to the DB as
    WKT (EPSG:4326), splitting the path at large time gaps so disconnected
    deployments don't get bridged. Full-resolution tracks are never stored —
    they stay in ERDDAP and are fetched live on preview/download.

This mirrors the role of profiles.get_profiles() but emits a line-per-
trajectory frame instead of a point-per-profile frame.
"""

import logging

import pandas as pd
import requests

from cde_harvester.ERDDAP import ERDDAP
from cde_harvester.harvest_errors import ResponseTooLargeError

logger = logging.getLogger(__name__)

# Starting decimation bin. Configurable here (could be promoted to
# harvest_config.yaml); doubled by the coarsen-and-retry guard when a dataset's
# decimated response blows past TRAJECTORY_MAX_ROWS / MAX_RESPONSE_SIZE.
TRAJECTORY_DECIMATE_HOURS = 6
# Soft cap on total decimated track points returned for one dataset. Beyond
# this we coarsen and retry rather than stream a huge response. (The hard
# byte ceiling is ERDDAP.MAX_RESPONSE_SIZE.)
TRAJECTORY_MAX_ROWS = 500_000
# Don't coarsen past this bin — at some point the track is too sparse to be a
# useful line and we fall back to no geometry for that dataset.
TRAJECTORY_MAX_DECIMATE_HOURS = 24 * 16  # 16 days
# A trajectory is split into separate line segments wherever it goes this long
# with no data — a real deployment gap (separate deployments under one reused
# trajectory_id, a glider that surfaced weeks apart, a coverage hole), not just
# sparse sampling. Splitting avoids drawing a straight connector across the gap;
# the result is a MultiLineString. This bound is ABSOLUTE (wall-clock), so it
# holds no matter how coarse a dataset's decimation ended up — a relative
# "N × interval" bound balloons when the coarsen-and-retry guard doubles the
# interval, which is exactly when connectors over big gaps reappeared.
TRAJECTORY_GAP_HOURS = 24


def _decimated_track_query(dataset, traj_var, cols, interval):
    """Fire one orderByClosest decimated-track query for the whole dataset.

    `cols` is the comma-separated results-variable list (de-duplicated by the
    caller). Returns a DataFrame decimated to ~one row per trajectory per
    `interval`.
    """
    order_by = requests.utils.quote(f'&orderByClosest("{traj_var},time/{interval}")')
    return dataset.dataset_tabledap_query(cols + order_by)


def _build_multilinestring(group, gap_threshold):
    """Build a WKT MultiLineString (lon lat order, EPSG:4326) from one
    trajectory's time-ordered points.

    The path is broken into separate segments wherever the time gap between two
    consecutive points exceeds `gap_threshold` (a pd.Timedelta), so a re-used
    trajectory_id spanning multiple deployments — or a single track with a long
    coverage gap — renders as disconnected lines instead of one line jumping
    across the gap. Returns None if no segment has >= 2 distinct coordinates.
    """
    segments = []
    current = []
    prev_time = None
    for time, lat, lon in zip(group["time"], group["latitude"], group["longitude"]):
        if prev_time is not None and (time - prev_time) > gap_threshold:
            segments.append(current)
            current = []
        current.append((round(lon, 5), round(lat, 5)))
        prev_time = time
    if current:
        segments.append(current)

    # Within each segment, dedupe identical coordinates (preserving order) and
    # keep only segments that still have >= 2 distinct vertices.
    parts = [
        coords
        for seg in segments
        if len(coords := list(dict.fromkeys(seg))) >= 2
    ]
    if not parts:
        return None
    return "MULTILINESTRING(" + ",".join(
        "(" + ",".join(f"{lon} {lat}" for lon, lat in coords) + ")" for coords in parts
    ) + ")"


def get_trajectories(dataset):
    """Extract one coarse-LineString record per trajectory in a dataset.

    Returns a DataFrame with the cde.trajectories load contract:
      erddap_url, dataset_id, trajectory_id, geom_wkt, time_min, time_max,
      depth_min, depth_max, n_records, records_per_day
    Empty DataFrame if the dataset has no trajectory_id variable or no usable
    track could be decimated.
    """
    dataset.get_profile_variables()
    traj_var = dataset.trajectory_id_variable
    logger_ = dataset.logger

    if not traj_var:
        logger_.warning("Trajectory dataset has no trajectory_id cf_role variable")
        return pd.DataFrame()

    # orderByClosest bins by time, so trajectory_id must be a distinct variable
    # from time. Some datasets set cf_role=trajectory_id on the time variable
    # itself (bad metadata) — we can't build a per-trajectory track from that.
    if traj_var == "time":
        logger_.warning(
            "trajectory_id cf_role is on the 'time' variable; cannot build a track for %s",
            dataset.id,
        )
        return pd.DataFrame()

    # Results-variable list, de-duplicated in case trajectory_id is latitude or
    # longitude (otherwise the column would be listed twice and ERDDAP rejects
    # the query with a 400).
    result_cols = []
    for v in [traj_var, "time", "latitude", "longitude"]:
        if v not in result_cols:
            result_cols.append(v)
    cols = ",".join(result_cols)

    # --- decimated track query, with coarsen-and-retry guard ---
    hours = TRAJECTORY_DECIMATE_HOURS
    track = pd.DataFrame()
    while True:
        # ERDDAP orderByClosest wants a "<number> <units>" interval (e.g.
        # "6 hours"), NOT an ISO-8601 duration like "PT6H".
        interval = f"{hours} hours"
        try:
            track = _decimated_track_query(dataset, traj_var, cols, interval)
        except ResponseTooLargeError as e:
            logger_.warning("Track query too large at %s: %s", interval, e)
            track = None

        too_big = track is None or len(track) > TRAJECTORY_MAX_ROWS
        if not too_big:
            break
        hours *= 2
        if hours > TRAJECTORY_MAX_DECIMATE_HOURS:
            logger_.error(
                "Trajectory track still too large at coarsest bin; "
                "storing no geometry for %s",
                dataset.id,
            )
            return pd.DataFrame()
        logger_.info("Coarsening trajectory decimation to %s hours and retrying", hours)

    if track is None or track.empty:
        logger_.warning("No trajectory track data returned")
        return pd.DataFrame()

    # numeric lat/lon + validity filter (same bounds as profiles.py)
    track["latitude"] = pd.to_numeric(track["latitude"], errors="coerce")
    track["longitude"] = pd.to_numeric(track["longitude"], errors="coerce")
    track = track.dropna(subset=["latitude", "longitude", traj_var])
    track = track.query(
        "latitude > -90 and latitude < 90 and longitude > -180 and longitude < 180"
    )
    if track.empty:
        return pd.DataFrame()

    track["time"] = ERDDAP.parse_erddap_dates(track["time"])
    track = track.dropna(subset=["time"]).sort_values([traj_var, "time"])

    # --- one record per trajectory ---
    # Split the track wherever it goes >= TRAJECTORY_GAP_HOURS with no data.
    # The decimation interval `hours` (possibly coarsened above) is a floor: a
    # heavily-coarsened dataset returns points up to ~2 intervals apart even
    # where data is continuous, so the threshold must stay above the interval or
    # a normally-sampled track would shatter. 3x the interval clears that; the
    # absolute cap wins for every normal / lightly-coarsened dataset.
    gap_threshold = pd.Timedelta(hours=max(TRAJECTORY_GAP_HOURS, hours * 3))
    records = []
    for traj_id, group in track.groupby(traj_var):
        wkt = _build_multilinestring(group, gap_threshold)
        if wkt is None:
            continue
        records.append(
            {
                "trajectory_id": str(traj_id),
                "geom_wkt": wkt,
                "time_min": group["time"].min(),
                "time_max": group["time"].max(),
            }
        )

    if not records:
        logger_.warning("No usable trajectory lines built")
        return pd.DataFrame()

    df = pd.DataFrame(records).set_index("trajectory_id")

    # --- per-trajectory depth range (one extra dataset-wide query) ---
    if "depth" in dataset.variables_list:
        try:
            depth = dataset.get_max_min([traj_var, "depth"])
            depth.index = depth.index.astype(str)
            df = df.join(depth, how="left")
        except Exception:
            logger_.warning("Could not fetch trajectory depth range", exc_info=True)
    if "depth_min" not in df:
        df["depth_min"] = 0
        df["depth_max"] = 0
    df["depth_min"] = df["depth_min"].fillna(0)
    df["depth_max"] = df["depth_max"].fillna(0)

    # --- per-trajectory record count (one extra dataset-wide query) ---
    df["n_records"] = None
    try:
        order_by = requests.utils.quote(f'&orderByCount("{traj_var}")')
        counts = dataset.dataset_tabledap_query(f"{traj_var},time" + order_by)
        if not counts.empty:
            counts = counts.set_index(traj_var)["time"]
            counts.index = counts.index.astype(str)
            df["n_records"] = counts
    except Exception:
        logger_.warning("Could not fetch trajectory record counts", exc_info=True)

    df = df.reset_index()
    df["n_records"] = pd.to_numeric(df["n_records"], errors="coerce")

    days = (df["time_max"] - df["time_min"]).dt.days.replace(0, 1)
    df["records_per_day"] = df["n_records"] / days

    df["dataset_id"] = dataset.id
    df["erddap_url"] = dataset.erddap_url

    # Make dataset.get_df() report the trajectory count as n_profiles and avoid
    # the AttributeError on self.profile_ids (the trajectory path never calls
    # get_profile_ids()).
    dataset.profile_ids = df

    return df.round(5)
