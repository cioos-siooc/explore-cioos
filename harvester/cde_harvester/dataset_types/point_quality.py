"""Structural QC for cdm_data_type=Point.

Point is the cdm_data_type ERDDAP generates when a dataset admin sets nothing,
so unlike every other type it cannot be taken at its word. A survey of the
configured servers while designing this found gliders, drifters, HF-radar
grids, CTD casts and net tows at stations all declaring Point. Harvesting them
as scattered independent samples would draw each one wrongly on the map.

Three probe results shaped the approach, all measured against live servers:

1. ``&orderByCount()`` with no arguments is rejected (HTTP 400) — there is no
   cheap whole-dataset row count that way.
2. ``?latitude,longitude&distinct()`` on a glider returned 912,079 rows, so a
   distinct-locations probe is not a cheap test. dataset.get_profile_ids warns
   about this same trap.
3. The glider and the net tow BOTH declare featureType=Point and have no
   cf_role variable at all. No metadata signal separates them from a genuine
   point dataset — the tests have to look at the data.

So QC runs two bounded probes and decides in pandas:

* Probe A — per-cell record counts for the whole dataset, reduced server-side
  by the same interval grouping the trajectory pipeline uses. One request;
  5 rows for that 912k-fix glider.
* Probe B — a few short windows of raw rows, sized off the time actual_range.

Test ORDER is deliberate and load-bearing: a glider's fixes round to a single
position at metre precision, so the cast and station tests would both fire on
one. Asking "is this a moving platform?" first is what makes the diagnosis the
admin receives the correct one.
"""

import numpy as np
import pandas as pd
import requests
from requests.exceptions import HTTPError

from cde_harvester.core.errors import (
    POINT_DUPLICATE_RECORDS,
    POINT_MULTI_DEPTH_PER_SITE,
    POINT_QC_INCONCLUSIVE,
    POINT_REPEATED_LOCATIONS,
    POINT_SINGLE_LOCATION,
    POINT_TRAJECTORY_SHAPED,
    ResponseTooLargeError,
)
from cde_harvester.dataset_types.base import DatasetQualityReport
from cde_harvester.dataset_types.trajectory_features import (
    KM_PER_DEGREE_LATITUDE,
    _binned_count,
)
from cde_harvester.sources.erddap.client import ERDDAP

# --- Probe B sizing ---------------------------------------------------------
# Sample from days ERDDAP tells us have data, rather than from windows carved
# out of the time span. Measured the hard way: the reference glider's
# actual_range spans 54 days but only 14 of them hold records, so evenly
# spaced windows landed in deployment gaps and returned nothing at all.
SAMPLE_WINDOW_COUNT = 3
# A dataset no bigger than this is fetched whole rather than sampled — one
# query of roughly a megabyte, and the tests then run on complete evidence
# instead of on a handful of rows. This is what a sparse dataset needs: a CTD
# station archive of 4,000 records spread over 900 days yields ~13 rows from
# three sampled days, too few to conclude anything, and "too few to conclude"
# was silently accepting datasets rather than rejecting them.
SAMPLE_FULL_MAX_RECORDS = 20_000
# Rows wanted per sampled day. A day holding more than this is narrowed to a
# centred slice; the slice can still miss a within-day gap, so an empty one
# falls back to the whole day.
SAMPLE_ROWS_PER_WINDOW = 1500
# The narrowed slice never goes below this — a few seconds of a 1 Hz dataset
# would show motion but no spatial spread.
SAMPLE_WINDOW_MIN = pd.Timedelta(minutes=30)
# A slice that comes back too large is halved this many times before the day
# is abandoned. The other sampled days still count.
SAMPLE_WINDOW_RETRIES = 3
# Below this many sampled rows the fractions below are noise, so we decline to
# judge — which under strict QC means the dataset is skipped as unverified,
# not quietly accepted.
SAMPLE_MIN_ROWS = 20
# When the frame IS the whole dataset there is no more evidence to be had, so
# the floor is only what the statistics need rather than a sampling guard.
COMPLETE_MIN_ROWS = 5

# Positions are compared at ~1 m precision. Coarser would merge genuinely
# distinct nearby samples; finer would treat a station's GPS jitter as motion.
POSITION_DECIMALS = 5

# --- Test 1: trajectory-shaped ---------------------------------------------
# What makes a track a track is that consecutive-in-time records are far
# closer to each other than the dataset's overall footprint: the platform
# creeps along a path instead of hopping around a region. Comparing the median
# step to the footprint's diagonal makes this scale-free, which matters
# because the platforms differ by orders of magnitude — a glider steps ~0.6 m
# between 2-second fixes, an hourly drifter hundreds of metres. An absolute
# step threshold accepted the glider and missed the drifter.
TRAJECTORY_STEP_TO_EXTENT_MAX = 0.02
# The ratio alone is not sufficient: spread enough stations over a big enough
# region and consecutive visits are "relatively" close by construction. A
# research vessel's CTD archive — 3,600 stations across 4,800 km of ocean,
# 26 km between consecutive casts — cleared the ratio comfortably and was
# reported as a glider. So also require the steps to be short in absolute
# terms. 2 km is generous for anything that samples while moving (a glider
# steps metres, an hourly drifter hundreds of metres) and far below the
# distance a ship covers between one station and the next.
TRAJECTORY_MAX_MEDIAN_STEP_M = 2000
# A step of exactly zero is not slow movement, it is no movement: repeated
# records at one position (a cast, a mooring). Those belong to the tests below.
TRAJECTORY_MIN_MEDIAN_STEP_M = 0.01
# ...and it has to actually go somewhere, over many distinct positions, so a
# jittering mooring can't qualify.
TRAJECTORY_MIN_PATH_M = 200
TRAJECTORY_MIN_PATH_TO_STEP_RATIO = 20
TRAJECTORY_MIN_DISTINCT_POSITIONS = 50

# --- Test 2: single location (Probe A, whole dataset) -----------------------
# One occupied 1/12-degree cell and a real record count is a fixed instrument.
SINGLE_LOCATION_MIN_RECORDS = 100

# --- Test 3: casts ----------------------------------------------------------
# A position holding several distinct depths across a real vertical span is a
# cast, not a point sample. Both conditions are needed: 3 depths within 20 cm
# is instrument noise, while 3 depths across 50 m is a profile.
MULTI_DEPTH_MIN_LEVELS = 3
MULTI_DEPTH_MIN_SPAN_M = 5
MULTI_DEPTH_GROUP_FRACTION = 0.5

# --- Test 4: stations -------------------------------------------------------
# Few positions, each revisited: a station network or a mooring array.
REPEATED_LOCATION_MIN_RECORDS = 5
REPEATED_LOCATION_MAX_POSITIONS = 200

# --- Test 5: duplicates -----------------------------------------------------
# Identical time AND position AND depth appearing more than once. Some
# duplication is ordinary (two instruments, one timestamp); a fifth of the
# dataset is a structural problem.
DUPLICATE_FRACTION_MAX = 0.20


def _step_distances_m(latitudes, longitudes):
    """Distance between consecutive positions, in metres.

    Equirectangular approximation with longitude scaled by cos(latitude) —
    the same approach _decimate_tracks uses for its simplification tolerance.
    Exact enough at the hundred-metre scale these thresholds work at.
    """
    lat = np.asarray(latitudes, dtype=float)
    lon = np.asarray(longitudes, dtype=float)
    mean_lat_rad = np.radians(np.nanmean(lat))
    dlat = np.diff(lat) * KM_PER_DEGREE_LATITUDE
    dlon = np.diff(lon) * KM_PER_DEGREE_LATITUDE * np.cos(mean_lat_rad)
    return np.hypot(dlat, dlon) * 1000.0


def _extent_diagonal_m(sample):
    """Diagonal of the sample's lat/lon bounding box, in metres."""
    lat = sample["latitude"].astype(float)
    lon = sample["longitude"].astype(float)
    return float(_step_distances_m([lat.min(), lat.max()], [lon.min(), lon.max()])[0])


def probe_active_days(dataset):
    """Days that actually hold records, and how many each holds.

    One grouped request (``orderByCount("time/1day")``), bounded by the number
    of days the dataset covers. Returns a frame of [day, count], or an empty
    frame. Deliberately does not use time's actual_range: several Point
    datasets have none, and on the reference glider the range spans 54 days
    while only 14 hold data.
    """
    # The counted variable has to differ from the grouped one, or ERDDAP
    # returns the bins with no count column.
    query = "time,latitude" + requests.utils.quote('&orderByCount("time/1day")')
    try:
        df_days = dataset.dataset_tabledap_query(query)
    except (HTTPError, ResponseTooLargeError):
        dataset.logger.warning("Per-day count probe failed; cannot sample dataset for Point QC")
        return pd.DataFrame()
    if df_days.empty:
        return pd.DataFrame()

    days = pd.DataFrame(
        {
            "day": ERDDAP.parse_erddap_dates(df_days["time"]),
            "count": pd.to_numeric(df_days["latitude"], errors="coerce"),
        }
    )
    return days.dropna().sort_values("day").reset_index(drop=True)


def _fetch_day(dataset, request_vars, day, day_count):
    """Raw rows from one day that is known to hold data.

    A day busier than SAMPLE_ROWS_PER_WINDOW is narrowed to a centred slice.
    The slice can still land in a within-day gap, so an empty one falls back
    to the whole day — which is known to have records.
    """
    day_start, day_end = day, day + pd.Timedelta(days=1)

    def fetch(start, end):
        width = end - start
        for _ in range(SAMPLE_WINDOW_RETRIES):
            query = (
                ",".join(request_vars)
                + f"&time>={start.strftime('%Y-%m-%dT%H:%M:%SZ')}"
                + f"&time<={(start + width).strftime('%Y-%m-%dT%H:%M:%SZ')}"
            )
            try:
                return dataset.dataset_tabledap_query(query)
            except ResponseTooLargeError:
                width = width / 2
            except HTTPError:
                return pd.DataFrame()
        return pd.DataFrame()

    if day_count > SAMPLE_ROWS_PER_WINDOW:
        width = max(
            pd.Timedelta(days=1) * (SAMPLE_ROWS_PER_WINDOW / day_count),
            SAMPLE_WINDOW_MIN,
        )
        centre = day_start + pd.Timedelta(hours=12)
        sliced = fetch(centre - width / 2, centre + width / 2)
        if not sliced.empty:
            return sliced
    return fetch(day_start, day_end)


def probe_sample(dataset, days=None, total_records=None):
    """Probe B: the dataset's raw positions — all of them when it is small
    enough, otherwise rows from a few days that are known to hold data.

    Returns (frame, is_complete). Columns: time (tz-aware), latitude,
    longitude, and depth when the dataset has one. is_complete says whether
    the frame is the whole dataset, which decides how much evidence the tests
    are entitled to demand.
    """
    has_depth = "depth" in dataset.variables_list
    request_vars = ["time", "latitude", "longitude"] + (["depth"] if has_depth else [])

    if total_records is not None and total_records <= SAMPLE_FULL_MAX_RECORDS:
        try:
            whole = dataset.dataset_tabledap_query(",".join(request_vars))
        except (HTTPError, ResponseTooLargeError):
            whole = pd.DataFrame()
        if not whole.empty:
            return _clean_sample(whole, has_depth), True

    if days is None:
        days = probe_active_days(dataset)
    if days.empty:
        return pd.DataFrame(), False

    # Spread the picks across the dataset's life: a mooring that was later
    # redeployed elsewhere, or a survey that became a transect, only shows
    # that in its later days.
    n_days = len(days)
    positions = (
        range(n_days)
        if n_days <= SAMPLE_WINDOW_COUNT
        else [
            int(n_days * (2 * i + 1) / (2 * SAMPLE_WINDOW_COUNT))
            for i in range(SAMPLE_WINDOW_COUNT)
        ]
    )

    frames = []
    for position in dict.fromkeys(positions):
        row = days.iloc[position]
        frame = _fetch_day(dataset, request_vars, row["day"], row["count"])
        if not frame.empty:
            frames.append(frame)
    if not frames:
        return pd.DataFrame(), False

    return _clean_sample(pd.concat(frames, ignore_index=True), has_depth), False


def _clean_sample(sample, has_depth):
    """Coerce a raw tabledap response into the frame the tests expect."""
    sample = sample.copy()
    sample["time"] = ERDDAP.parse_erddap_dates(sample["time"])
    for column in ["latitude", "longitude"] + (["depth"] if has_depth else []):
        sample[column] = pd.to_numeric(sample[column], errors="coerce")
    sample = sample.dropna(subset=["time", "latitude", "longitude"])
    return sample.sort_values("time").reset_index(drop=True)


def probe_cells(dataset):
    """Probe A: (total_records, n_cells) for the whole dataset, or (None, None).

    One server-side grouped request via the trajectory pipeline's binning.
    """
    try:
        df_count = _binned_count(dataset, None)
    except (HTTPError, ResponseTooLargeError):
        dataset.logger.warning("Cell-count probe failed; Point QC will use the sample only")
        return None, None
    if df_count.empty:
        return None, None
    counts = pd.to_numeric(df_count["time"], errors="coerce").dropna()
    if counts.empty:
        return None, None
    return int(counts.sum()), int(len(counts))


def _check_trajectory(sample, min_rows):
    """Runs first: a moving platform's fixes round to one position at metre
    precision, so the cast and station tests would both misfire on a glider."""
    if len(sample) < min_rows:
        return None
    positions = sample[["latitude", "longitude"]].round(POSITION_DECIMALS)
    n_distinct = len(positions.drop_duplicates())
    if n_distinct < TRAJECTORY_MIN_DISTINCT_POSITIONS:
        return None

    steps = _step_distances_m(sample["latitude"], sample["longitude"])
    deltas = sample["time"].diff().dt.total_seconds().to_numpy()[1:]
    if not len(steps):
        return None
    median_step = float(np.nanmedian(steps))
    median_dt = float(np.nanmedian(deltas))
    path_m = float(np.nansum(steps))
    extent_m = _extent_diagonal_m(sample)

    # Zero median step means the records are not moving at all — repeated
    # positions, which the cast and station tests below explain properly.
    if not TRAJECTORY_MIN_MEDIAN_STEP_M <= median_step <= TRAJECTORY_MAX_MEDIAN_STEP_M:
        return None
    if path_m < TRAJECTORY_MIN_PATH_M:
        return None
    if path_m / median_step < TRAJECTORY_MIN_PATH_TO_STEP_RATIO:
        return None
    # The scale-free test: does it creep along a path, or hop around a region?
    if not extent_m or median_step / extent_m > TRAJECTORY_STEP_TO_EXTENT_MAX:
        return None

    return DatasetQualityReport(
        POINT_TRAJECTORY_SHAPED,
        f"The sampled records trace a continuous path: {n_distinct} distinct "
        f"positions, a median of {median_step:.1f} m between consecutive records "
        f"taken a median of {median_dt:.0f} s apart, covering {path_m / 1000:.1f} km "
        f"within a {extent_m / 1000:.1f} km footprint. Consecutive records are "
        f"{extent_m / median_step:.0f}x closer to each other than the dataset is "
        f"wide, which means the platform moved along a track rather than sampling "
        f"independent locations. A CF 'Point' dataset holds independent samples "
        f"with no path between them; this is a moving platform (glider, drifter, "
        f"or ship underway). Set cdm_data_type=Trajectory and add a variable with "
        f"cf_role=trajectory_id identifying the deployment or mission. "
        f"(Thresholds: median step under {TRAJECTORY_MAX_MEDIAN_STEP_M} m and "
        f"below {TRAJECTORY_STEP_TO_EXTENT_MAX:.0%} of the footprint diagonal, "
        f"over a path of at least {TRAJECTORY_MIN_PATH_M} m.)",
    )


def _check_single_location(total_records, n_cells):
    if n_cells != 1 or not total_records or total_records < SINGLE_LOCATION_MIN_RECORDS:
        return None
    return DatasetQualityReport(
        POINT_SINGLE_LOCATION,
        f"All {total_records:,} records of this dataset fall in a single "
        f"1/12-degree grid cell, so every observation shares one location. "
        f"That is a fixed instrument, not a set of independent point samples. "
        f"Set cdm_data_type=TimeSeries and add a variable with "
        f"cf_role=timeseries_id naming the station or mooring.",
    )


def _check_multi_depth(sample, min_rows):
    if "depth" not in sample.columns or len(sample) < min_rows:
        return None
    with_depth = sample.dropna(subset=["depth"])
    if len(with_depth) < min_rows:
        return None
    grouped = with_depth.assign(
        _lat=with_depth["latitude"].round(POSITION_DECIMALS),
        _lon=with_depth["longitude"].round(POSITION_DECIMALS),
    ).groupby(["_lat", "_lon"])["depth"]
    levels = grouped.nunique()
    spans = grouped.max() - grouped.min()
    is_cast = (levels >= MULTI_DEPTH_MIN_LEVELS) & (spans >= MULTI_DEPTH_MIN_SPAN_M)
    if not len(levels):
        return None
    fraction = float(is_cast.mean())
    if fraction < MULTI_DEPTH_GROUP_FRACTION:
        return None
    return DatasetQualityReport(
        POINT_MULTI_DEPTH_PER_SITE,
        f"{is_cast.sum()} of {len(levels)} sampled positions "
        f"({fraction:.0%}) hold {MULTI_DEPTH_MIN_LEVELS} or more distinct depths "
        f"spanning at least {MULTI_DEPTH_MIN_SPAN_M} m — a median of "
        f"{levels.median():.0f} depths over {spans.median():.1f} m. These are "
        f"vertical profiles (casts), not independent point samples. "
        f"Set cdm_data_type=Profile and add a variable with cf_role=profile_id "
        f"identifying each cast.",
    )


def _check_repeated_locations(sample, min_rows):
    if len(sample) < min_rows:
        return None
    positions = sample[["latitude", "longitude"]].round(POSITION_DECIMALS)
    per_position = positions.groupby(["latitude", "longitude"]).size()
    n_positions = len(per_position)
    median_records = float(per_position.median())
    if n_positions > REPEATED_LOCATION_MAX_POSITIONS:
        return None
    if median_records < REPEATED_LOCATION_MIN_RECORDS:
        return None
    return DatasetQualityReport(
        POINT_REPEATED_LOCATIONS,
        f"The {len(sample):,} sampled records fall on only {n_positions} distinct "
        f"positions, a median of {median_records:.0f} records each (up to "
        f"{per_position.max():,}). Repeat visits to fixed positions are a station "
        f"network, not independent point samples. Set cdm_data_type=TimeSeries "
        f"(or TimeSeriesProfile if each visit also profiles the water column) and "
        f"add a variable with cf_role=timeseries_id naming the station.",
    )


def _check_duplicates(sample, min_rows):
    if len(sample) < min_rows:
        return None
    key = ["time", "latitude", "longitude"] + (
        ["depth"] if "depth" in sample.columns else []
    )
    n_duplicated = int(sample.duplicated(subset=key).sum())
    fraction = n_duplicated / len(sample)
    if fraction < DUPLICATE_FRACTION_MAX:
        return None
    return DatasetQualityReport(
        POINT_DUPLICATE_RECORDS,
        f"{n_duplicated:,} of {len(sample):,} sampled records ({fraction:.0%}) "
        f"repeat a ({', '.join(key)}) combination already present in the dataset. "
        f"Every record in a CF 'Point' dataset should be an independent sample, so "
        f"there is no way to tell these apart or to place them on a map "
        f"individually. Either the records are distinguished by a variable that "
        f"should carry a cf_role (making this a Profile or TimeSeries), or they "
        f"are unintended duplicates in the source files.",
    )


def check_point_dataset(dataset):
    """Run the structural QC suite. Returns a report to skip, or None to accept.

    Also returns the whole-dataset record count via ``dataset.point_total_records``
    so the handler can choose its representation without re-querying.
    """
    total_records, n_cells = probe_cells(dataset)

    days = probe_active_days(dataset)
    if total_records is None and not days.empty:
        # The cell probe is the preferred source (it is the same grouping the
        # cells representation uses), but the day counts cover the same rows.
        total_records = int(days["count"].sum())
    dataset.point_total_records = total_records

    sample, is_complete = probe_sample(dataset, days=days, total_records=total_records)

    # A complete dataset is its own evidence, however small; a sample has to
    # be thick enough for the fractions below to mean anything.
    min_rows = COMPLETE_MIN_ROWS if is_complete else SAMPLE_MIN_ROWS

    if len(sample) < min_rows:
        return DatasetQualityReport(
            POINT_QC_INCONCLUSIVE,
            f"Only {len(sample)} usable records could be read from this dataset "
            f"({'the whole dataset' if is_complete else 'sampled across the days that report data'}), "
            f"which is not enough to confirm that it holds independent point "
            f"samples rather than a mooring, a set of casts or a platform track. "
            f"cdm_data_type=Point is ERDDAP's default, so it is only harvested "
            f"once verified. Check that the dataset is queryable and that time, "
            f"latitude and longitude return the values you expect.",
        )

    # Order is load-bearing — see the module docstring.
    for report in (
        _check_trajectory(sample, min_rows),
        _check_single_location(total_records, n_cells),
        _check_multi_depth(sample, min_rows),
        _check_repeated_locations(sample, min_rows),
        _check_duplicates(sample, min_rows),
    ):
        if report is not None:
            return report

    return None
