"""Coverage-corridor footprints (Stage 1.5 of docs/trajectory-next-stages.md).

The 1/12-degree coverage cells are binned from full-resolution data, so cells
only exist where records exist: coarse fix spacing renders as a dotted track
once map hexes are smaller than the spacing. The corridor is the deliberate
fix — a translucent buffered swath per dataset shown at point zoom, visibly
"coverage envelope, not precise track".

This module only produces the corridor's *skeleton*: one WKT line (or
multipoint, on the no-points fallback) per (trajectory, segment, ~30-day time
slice), plus the buffer radius. The geodesic buffering/simplification happens
in PostGIS at load time (see trajectory_footprints_insert_from_temp in
database/5_profile_process.sql) — the harvester ships no geometry deps.

Time-slicing at fixed epoch-aligned boundaries is what makes the /tiles time
filter trim the corridor *spatially* and keeps the hover "days of record"
cumulative math honest (slices are merged, never first-to-last spans).
"""

import logging
import os

import pandas as pd

logger = logging.getLogger(__name__)

# Corridor half-width in km. Fixed in geographic units (not pixels) on
# purpose: the swath reads coarser as you zoom in, signalling "coverage".
FOOTPRINT_KM_DEFAULT = 5
# Slice length in days. Smaller = finer time-filter trimming, more rows.
SLICE_DAYS_DEFAULT = 30

# Slices align to a fixed epoch so different trajectories/datasets share
# boundaries (cross-trajectory interval merging then dedupes cleanly).
_EPOCH = pd.Timestamp("1970-01-01", tz="UTC")

FOOTPRINT_COLUMNS = [
    "erddap_url", "dataset_id", "trajectory_id", "segment_id",
    "time_min", "time_max", "depth_min", "depth_max",
    "buffer_m", "track_wkt",
]


def buffer_m():
    return float(os.environ.get("TRAJ_FOOTPRINT_KM", FOOTPRINT_KM_DEFAULT)) * 1000


def slice_days():
    return int(os.environ.get("TRAJ_FOOTPRINT_SLICE_DAYS", SLICE_DAYS_DEFAULT))


def _slice_index(times, days):
    return ((times - _EPOCH) // pd.Timedelta(days=days)).astype("int64")


def _fmt(value):
    return f"{value:.6f}"


def _line_wkt(lons, lats):
    """WKT for a lon/lat sequence; degenerate single points stay POINTs so
    PostGIS buffers them into discs."""
    pts = list(dict.fromkeys(zip(map(_fmt, lons), map(_fmt, lats))))
    if len(pts) == 1:
        return f"POINT({pts[0][0]} {pts[0][1]})"
    return "LINESTRING(" + ",".join(f"{x} {y}" for x, y in pts) + ")"


def _multipoint_wkt(lons, lats):
    pts = dict.fromkeys(zip(map(_fmt, lons), map(_fmt, lats)))
    return "MULTIPOINT(" + ",".join(f"({x} {y})" for x, y in pts) + ")"


def footprints_from_points(points, days, radius_m):
    """Corridor skeleton rows from decimated, segmented points.

    Each (trajectory, segment) is cut at epoch-aligned ``days`` boundaries;
    every slice's line also carries the FIRST point of the next slice in the
    same segment (bridge point), so consecutive buffered slices overlap
    seamlessly instead of meeting at a joint.
    """
    df = points.sort_values(
        ["trajectory_id", "segment_id", "time"], kind="mergesort"
    ).reset_index(drop=True)
    df["slice_id"] = _slice_index(df["time"], days)

    rows = []
    for (traj, seg), seg_df in df.groupby(["trajectory_id", "segment_id"], sort=False):
        slices = [g for _, g in seg_df.groupby("slice_id", sort=True)]
        for i, g in enumerate(slices):
            lons = g["longitude"].tolist()
            lats = g["latitude"].tolist()
            if i + 1 < len(slices):
                bridge = slices[i + 1].iloc[0]
                lons.append(bridge["longitude"])
                lats.append(bridge["latitude"])
            rows.append({
                "trajectory_id": traj,
                "segment_id": int(seg),
                "time_min": g["time"].min(),
                "time_max": g["time"].max(),
                "depth_min": g["depth"].min(),
                "depth_max": g["depth"].max(),
                "buffer_m": radius_m,
                "track_wkt": _line_wkt(lons, lats),
            })
    return pd.DataFrame(rows)


def footprints_from_cells(cells, days, radius_m):
    """Fallback when decimated points are unavailable (no orderByClosest):
    one MULTIPOINT of cell centers per (trajectory, slice of cell time_min).
    Buffered discs bridge gaps whenever the radius exceeds half the fix
    spacing; beyond that the corridor stays dotted — degraded, never wrong.
    """
    df = cells.dropna(subset=["latitude", "longitude", "time_min"]).copy()
    if df.empty:
        return pd.DataFrame()
    df["slice_id"] = _slice_index(df["time_min"], days)

    rows = []
    for (traj, sl), g in df.groupby(["trajectory_id", "slice_id"], sort=True):
        rows.append({
            "trajectory_id": traj,
            "segment_id": 0,
            "time_min": g["time_min"].min(),
            "time_max": g["time_max"].max(),
            "depth_min": g["depth_min"].min(),
            "depth_max": g["depth_max"].max(),
            "buffer_m": radius_m,
            "track_wkt": _multipoint_wkt(g["longitude"], g["latitude"]),
        })
    return pd.DataFrame(rows)


def build_footprints(dataset, cells, points=None):
    """FOOTPRINT_COLUMNS-shaped frame for one dataset (may be empty).

    ``points`` is the (possibly empty) decimated frame from
    trajectory_points.extract_points; pass None to force the cells fallback.
    """
    days = slice_days()
    radius_m = buffer_m()

    if points is not None and not points.empty:
        footprints = footprints_from_points(points, days, radius_m)
    else:
        footprints = footprints_from_cells(cells, days, radius_m)

    if footprints.empty:
        return pd.DataFrame(columns=FOOTPRINT_COLUMNS)

    footprints["erddap_url"] = dataset.erddap_url
    footprints["dataset_id"] = dataset.id
    # Depth mirrors the cells convention: 0 when the dataset has none, so the
    # web-api depth filters treat corridors exactly like cells.
    footprints["depth_min"] = footprints["depth_min"].fillna(0)
    footprints["depth_max"] = footprints["depth_max"].fillna(0)

    dataset.logger.info(
        "Built %d corridor footprint slices for %s (%d trajectories)",
        len(footprints), dataset.id, footprints["trajectory_id"].nunique(),
    )
    return footprints[FOOTPRINT_COLUMNS]
