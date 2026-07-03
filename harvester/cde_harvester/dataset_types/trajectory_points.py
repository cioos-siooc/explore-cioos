"""Decimated trajectory positions (Stage 1 of docs/trajectory-next-stages.md).

One server-side ``orderByClosest`` query per dataset returns ~TRAJ_TARGET_POINTS
time-decimated positions — never the full-resolution track. The result is
sorted and gap-segmented so every downstream consumer (coverage-corridor
footprints now, the parquet/ClickHouse line store in M3) breaks lines at
exactly the same places.

Servers whose ERDDAP predates orderByClosest simply yield an empty frame:
coverage cells are unaffected and the corridor builder falls back to buffering
the cells instead.
"""

import logging
import math
import os

import numpy as np
import pandas as pd
import requests
from requests.exceptions import HTTPError

from cde_harvester.sources.erddap.client import ERDDAP

logger = logging.getLogger(__name__)

# Decimation target: points per dataset, before segmentation.
TARGET_POINTS_DEFAULT = 30000

# ERDDAP only accepts specific interval literals in orderByClosest; snap the
# computed interval UP to this ladder so the query is always legal.
INTERVAL_LADDER = [
    ("1minute", 60),
    ("5minutes", 300),
    ("15minutes", 900),
    ("30minutes", 1800),
    ("1hour", 3600),
    ("3hours", 10800),
    ("6hours", 21600),
    ("12hours", 43200),
    ("1day", 86400),
    ("3days", 259200),
    ("7days", 604800),
    ("30days", 2592000),
]

# Gap-segmentation thresholds: a new segment starts when the time gap exceeds
# max(GAP_INTERVAL_FACTOR x decimation interval, GAP_MIN_SECONDS) or when two
# consecutive fixes are further apart than GAP_MAX_KM (bad GPS, ferry legs).
GAP_INTERVAL_FACTOR = 4
GAP_MIN_SECONDS = 12 * 3600
GAP_MAX_KM = 200


def target_points():
    return int(os.environ.get("TRAJ_TARGET_POINTS", TARGET_POINTS_DEFAULT))


def snap_interval(interval_seconds, minimum=None):
    """Smallest ladder entry >= interval_seconds (and >= minimum if given).

    Returns (label, seconds); intervals beyond the ladder clamp to its top.
    """
    needed = max(interval_seconds, minimum or 0)
    for label, seconds in INTERVAL_LADDER:
        if seconds >= needed:
            return label, seconds
    return INTERVAL_LADDER[-1]


def compute_interval(cells):
    """Decimation interval from the summed per-trajectory time spans.

    The cells frame (already extracted, no extra queries) carries per-cell
    time extents; per-trajectory span = max(time_max) - min(time_min).
    """
    spans = cells.groupby("trajectory_id", dropna=False).agg(
        t0=("time_min", "min"), t1=("time_max", "max")
    )
    total_seconds = (spans["t1"] - spans["t0"]).dt.total_seconds().clip(lower=0).sum()
    if total_seconds <= 0:
        return INTERVAL_LADDER[0]
    return snap_interval(math.ceil(total_seconds / target_points()))


def haversine_km(lat1, lon1, lat2, lon2):
    """Vectorized great-circle distance in km (numpy arrays, degrees in)."""
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    a = (
        np.sin((lat2 - lat1) / 2) ** 2
        + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    )
    return 2 * 6371.0 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def segment_points(df, interval_seconds):
    """Sort by (trajectory, time) and assign gap-based segment_ids.

    New segment when, between consecutive fixes of one trajectory:
    - time gap > max(GAP_INTERVAL_FACTOR * interval, GAP_MIN_SECONDS), or
    - great-circle distance > GAP_MAX_KM, or
    - the raw longitudes wrap the antimeridian (|dlon| > 180) — geographically
      one hop, but a straight lon/lat line (and its buffered corridor) would
      smear across the world map, so break instead.
    """
    df = df.sort_values(["trajectory_id", "time"], kind="mergesort").reset_index(
        drop=True
    )
    gap_seconds = max(GAP_INTERVAL_FACTOR * interval_seconds, GAP_MIN_SECONDS)

    same_traj = df["trajectory_id"].eq(df["trajectory_id"].shift())
    dt = (df["time"] - df["time"].shift()).dt.total_seconds()
    dist = pd.Series(
        haversine_km(
            df["latitude"].shift().to_numpy(),
            df["longitude"].shift().to_numpy(),
            df["latitude"].to_numpy(),
            df["longitude"].to_numpy(),
        ),
        index=df.index,
    )
    dlon = (df["longitude"] - df["longitude"].shift()).abs()

    new_segment = (
        ~same_traj
        | (dt > gap_seconds)
        | (dist > GAP_MAX_KM)
        | (dlon > 180)
    )
    # segment_id restarts at 0 within each trajectory
    seg = new_segment.cumsum()
    df["segment_id"] = (
        seg - seg.groupby(df["trajectory_id"]).transform("min")
    ).astype("int64")
    return df


def _decimation_query(dataset, traj_var, has_depth, interval_label):
    request_vars = ([traj_var] if traj_var else []) + ["time", "latitude", "longitude"]
    if has_depth:
        request_vars.append("depth")
    group = f"{traj_var},time/{interval_label}" if traj_var else f"time/{interval_label}"
    url = ",".join(request_vars) + requests.utils.quote(
        f'&orderByClosest("{group}")'
    )
    return dataset.dataset_tabledap_query(url)


def _clean(df, traj_var, has_depth):
    """Parse/coerce the raw response and drop bad-geom rows (same bounds as
    the cell extraction)."""
    df = df.dropna(subset=["latitude", "longitude", "time"]).copy()
    if df.empty:
        return df
    df["time"] = ERDDAP.parse_erddap_dates(df["time"])
    df["latitude"] = pd.to_numeric(df["latitude"], errors="coerce")
    df["longitude"] = pd.to_numeric(df["longitude"], errors="coerce")
    if has_depth and "depth" in df:
        df["depth"] = pd.to_numeric(df["depth"], errors="coerce")
    else:
        df["depth"] = np.nan
    df["trajectory_id"] = (
        df[traj_var].astype(str) if traj_var else ""
    )
    df = df.dropna(subset=["latitude", "longitude", "time"])
    df = df.query(
        "latitude > -90 and latitude < 90 and longitude >= -180 and longitude <= 180"
    )
    return df[["trajectory_id", "time", "latitude", "longitude", "depth"]]


def extract_points(dataset, cells):
    """Decimated, segmented positions for one trajectory dataset.

    Returns (DataFrame[trajectory_id, segment_id, time, latitude, longitude,
    depth], interval_seconds). Empty frame when the server lacks
    orderByClosest or the response is unusable — callers must cope (cells
    still work, footprints fall back to buffered cells).
    """
    log = dataset.logger
    traj_var = dataset.trajectory_id_variable
    has_depth = "depth" in dataset.variables_list

    label, interval_seconds = compute_interval(cells)
    target = target_points()

    try:
        df = _decimation_query(dataset, traj_var, has_depth, label)
        # Over-dense response (many concurrent trajectories can multiply the
        # per-interval row count): coarsen once and retry, per the spec.
        if len(df) > 2 * target:
            label, interval_seconds = snap_interval(
                2 * interval_seconds, minimum=interval_seconds + 1
            )
            log.info(
                "Decimated response too large (%d rows); retrying at %s",
                len(df), label,
            )
            df = _decimation_query(dataset, traj_var, has_depth, label)
    except HTTPError as e:
        log.warning(
            "orderByClosest not available for %s (%s); skipping decimated "
            "points — corridor will fall back to coverage cells",
            dataset.id, e,
        )
        return pd.DataFrame(), interval_seconds

    df = _clean(df, traj_var, has_depth)
    if df.empty:
        log.warning("No usable decimated points for %s", dataset.id)
        return pd.DataFrame(), interval_seconds

    df = segment_points(df, interval_seconds)
    log.info(
        "Decimated %s to %d points (%s interval, %d segments)",
        dataset.id, len(df), label,
        df.groupby("trajectory_id")["segment_id"].nunique().sum(),
    )
    return df, interval_seconds
