"""Per-feature min/max/count pipeline shared by the point-like tabledap types;
type-specific behaviour goes through handler hooks, never cdm_data_type branches."""

from datetime import UTC, datetime

import pandas as pd
import requests
from requests.exceptions import HTTPError

from cde_harvester.core.day_sets import (
    bucket_index_to_day,
    day_bucket_group,
    days_to_ranges,
    total_days,
)
from cde_harvester.core.harvest_warnings import DAY_COUNT_FALLBACK, FEATURES_DROPPED
from cde_harvester.dataset_types.geo import classify_profile_location
from cde_harvester.sources.erddap.client import ERDDAP, ResponseTooLargeError
from cde_harvester.sources.erddap.dataset import is_valid_duration


def _axis_bounds_from_metadata(dataset, axis):
    """actual_range, else the geospatial_* globals; lets single-feature datasets
    skip the two orderByMinMax queries."""
    df_variables = dataset.df_variables
    if axis in df_variables.index:
        actual_range = df_variables.loc[axis].get("actual_range")
        if actual_range:
            parts = actual_range.split(",")
            if len(parts) == 2:
                try:
                    return float(parts[0]), float(parts[1])
                except ValueError:
                    pass
    key = "lat" if axis == "latitude" else "lon"
    lo = dataset.globals.get(f"geospatial_{key}_min")
    hi = dataset.globals.get(f"geospatial_{key}_max")
    if lo not in (None, "") and hi not in (None, ""):
        try:
            return float(lo), float(hi)
        except ValueError:
            pass
    return None


def _range_from_metadata(dataset, variable):
    """actual_range, else for time the time_coverage_* globals (a missing end
    reads as ongoing)."""
    actual_range = dataset.df_variables.loc[variable].get("actual_range")
    if actual_range and len(parts := actual_range.split(",")) == 2:
        return [part.strip() for part in parts]
    start = dataset.globals.get("time_coverage_start")
    if variable == "time" and start:
        return [start, dataset.globals.get("time_coverage_end") or "NaN"]
    return None


def _time_resolution(dataset):
    """Taken to hold for every feature in the dataset."""
    resolution = dataset.globals.get("time_coverage_resolution")
    if not resolution or not is_valid_duration(resolution):
        return None
    resolution = pd.Timedelta(resolution)
    return resolution if resolution > pd.Timedelta(0) else None


def _eovs_per_feature(profile_count, eov_variables, dataset_eovs):
    """A feature with no non-zero counts falls back to the dataset's EOVs: the
    web-api filters with an array overlap, so an empty list would silently hide
    the feature from every EOV selection."""
    if not eov_variables:
        return pd.Series(
            [list(dataset_eovs)] * len(profile_count), index=profile_count.index
        )

    per_feature = []
    for _, counts in profile_count.iterrows():
        eovs = []
        for variable, variable_eovs in eov_variables.items():
            count = counts.get(variable)
            if pd.notna(count) and count > 0:
                eovs.extend(eov for eov in variable_eovs if eov not in eovs)
        per_feature.append(sorted(eovs) if eovs else list(dataset_eovs))
    return pd.Series(per_feature, index=profile_count.index)


def _lat_lon_box(dataset, profiles, profile_variable_list, logger, identity):
    if len(profiles) == 1:
        lat_bounds = _axis_bounds_from_metadata(dataset, "latitude")
        lon_bounds = _axis_bounds_from_metadata(dataset, "longitude")
        if lat_bounds and lon_bounds:
            logger.debug("Using dataset metadata for lat/lon bounding box")
            idx = profiles.set_index(profile_variable_list).index
            return pd.DataFrame(
                {
                    "latitude_min": lat_bounds[0],
                    "latitude_max": lat_bounds[1],
                    "longitude_min": lon_bounds[0],
                    "longitude_max": lon_bounds[1],
                },
                index=idx,
            )

    if {"latitude", "longitude"} <= set(identity.columns):
        logger.debug("Using subset-table positions for lat/lon bounding box")
        return identity.groupby(profile_variable_list, dropna=False).agg(
            latitude_min=("latitude", "min"),
            latitude_max=("latitude", "max"),
            longitude_min=("longitude", "min"),
            longitude_max=("longitude", "max"),
        )

    lat_mm = dataset.get_max_min(profile_variable_list + ["latitude"])
    lon_mm = dataset.get_max_min(profile_variable_list + ["longitude"])
    if lat_mm.empty or lon_mm.empty:
        return pd.DataFrame()
    return lat_mm.join(lon_mm)


# Sanity ceiling on features x span-days. Deliberately loose: real responses
# only hold days with data (26% of the estimate for amundsen11975_ctd, 1% for a
# Hakai station set), so a tight cap would skip exactly the intermittent
# datasets this query exists for; the streamed MAX_RESPONSE_SIZE abort is the
# real memory backstop.
MAX_DAY_COUNT_ROWS = 20_000_000

# Variables to count, in preference order. orderByCount counts non-null values
# of a variable that is NOT one of the grouped ones — group it and ERDDAP
# returns the bins with no count column at all. Every tabledap dataset here has
# passed the compliance check, so it has all three.
_COUNT_CANDIDATES = ("latitude", "longitude", "time")


def _string_key(index):
    frame = index.to_frame(index=False).astype(str)
    if frame.shape[1] > 1:
        return pd.MultiIndex.from_frame(frame)
    return pd.Index(frame.iloc[:, 0], name=index.name)


def _extract_day_sets(
    dataset, profiles, profile_variable_list, logger,
    record_variables=(), eov_variables=(),
):
    """Per-feature day sets, record counts and EOV counts from one
    `orderByCount("<cf_role vars>,time/86400")`; None falls back to the time
    span (an over-count, but never worth dropping a dataset over).

    Three things about that query are easy to get wrong:

      * the counted variable must DIFFER from every grouped one, or ERDDAP
        returns the bins with no count column;
      * a cf_role variable can BE `time` (mpoSgdoADCP tags cf_role=profile_id
        on time itself). Grouping by both the raw time and its day bucket asks
        for one group per record, and repeating it in the variable list is a
        400 outright — so time is dropped from the grouping, which is what the
        day bucket already stands for;
      * the grouped time column comes back as the bucket INDEX, not a
        timestamp. `bucket_index_to_day` decodes it; reading it at face value
        silently collapses every row onto 1970-01-01.
    """
    # time_min/time_max are still raw ERDDAP strings: this must run while the
    # cf_role variables are still the index.
    span_start = ERDDAP.parse_erddap_date(profiles["time_min"].min())
    span_end = ERDDAP.parse_erddap_date(profiles["time_max"].max())
    if pd.isna(span_start) or pd.isna(span_end):
        dataset.warnings.add(
            DAY_COUNT_FALLBACK,
            "Cannot size the per-feature day count; using the time span",
        )
        return None
    span_days = max((span_end - span_start).days, 1)
    estimated_rows = len(profiles) * span_days
    if estimated_rows > MAX_DAY_COUNT_ROWS:
        dataset.warnings.add(
            DAY_COUNT_FALLBACK,
            f"Skipping per-feature day count: ~{estimated_rows} rows "
            f"({len(profiles)} features x {span_days} days) exceeds the "
            f"{MAX_DAY_COUNT_ROWS} cap; falling back to the time span",
        )
        return None

    group_vars = [v for v in profile_variable_list if v != "time"]
    counted = next((v for v in _COUNT_CANDIDATES if v not in group_vars), None)
    if counted is None:
        dataset.warnings.add(
            DAY_COUNT_FALLBACK,
            "No countable variable outside the group; using the time span",
        )
        return None

    record_columns = [counted] + [
        v for v in record_variables if v not in group_vars + ["time", counted]
    ]
    eov_columns = [
        v for v in eov_variables
        if v not in group_vars + ["time"] + record_columns
    ]
    request_vars = group_vars + ["time"] + record_columns + eov_columns
    url = ",".join(request_vars) + requests.utils.quote(
        f'&orderByCount("{day_bucket_group(group_vars)}")'
    )
    try:
        df_days = dataset.dataset_tabledap_query(url)
    except (HTTPError, ResponseTooLargeError):
        # e.g. an old ERDDAP without orderBy interval grouping
        dataset.warnings.add(
            DAY_COUNT_FALLBACK,
            "Per-feature day count failed; falling back to the time span",
        )
        return None

    if df_days.empty:
        # erddap_csv_to_df turns "no operator found" / "too much data" 500s
        # into an empty frame rather than raising.
        dataset.warnings.add(
            DAY_COUNT_FALLBACK,
            "Per-feature day count returned nothing; using the time span",
        )
        return None

    df_days = df_days.copy()
    df_days["day"] = bucket_index_to_day(df_days["time"], ERDDAP.parse_erddap_dates)
    df_days = df_days.dropna(subset=["day"])
    if df_days.empty:
        dataset.warnings.add(
            DAY_COUNT_FALLBACK,
            "Per-feature day count had no usable dates; using the time span",
        )
        return None

    count_columns = [c for c in record_columns + eov_columns if c in df_days]
    df_days[count_columns] = df_days[count_columns].apply(
        pd.to_numeric, errors="coerce"
    )
    df_days["_records"] = df_days[
        [c for c in record_columns if c in df_days]
    ].max(axis="columns")

    if group_vars:
        for column in group_vars:
            df_days[column] = df_days[column].astype(str)
        grouped = df_days.groupby(group_vars if len(group_vars) > 1 else group_vars[0])
    else:
        # Single-feature dataset with no cf_role variable: the group key must
        # match the frame's index for the caller's join to land.
        grouped = df_days.groupby(lambda _: profiles.index[0])

    day_sets = grouped["day"].apply(days_to_ranges).rename("day_ranges").to_frame()
    day_sets["days"] = day_sets["day_ranges"].apply(total_days)
    day_sets["n_records"] = grouped["_records"].sum()
    for column in eov_columns:
        if column in df_days:
            day_sets[column] = grouped[column].sum()

    # Align as strings: the identity frame reads an integer station id as int64
    # while these keys are str, and a dtype join would silently miss EVERY row.
    if day_sets.index.nlevels != profiles.index.nlevels:
        dataset.warnings.add(
            DAY_COUNT_FALLBACK,
            "Day-set grouping does not match the feature identity; using the time span",
        )
        return None

    day_sets = day_sets.reindex(_string_key(profiles.index))
    matched = day_sets["days"].notna()
    if not matched.any():
        dataset.warnings.add(
            DAY_COUNT_FALLBACK,
            "No day set matched a feature; using the time span",
        )
        return None
    if not matched.all():
        logger.info(
            "Day sets found for %d of %d features; the rest use the time span",
            int(matched.sum()), len(day_sets),
        )
    day_sets.index = profiles.index
    day_sets["day_ranges"] = day_sets["day_ranges"].apply(
        lambda runs: runs if isinstance(runs, list) else []
    )
    day_sets["n_records"] = day_sets["n_records"].fillna(0)
    return day_sets


def _timesteps(profiles, resolution):
    start = ERDDAP.parse_erddap_dates(profiles["time_min"].astype(str).str.strip())
    end = ERDDAP.parse_erddap_dates(profiles["time_max"].astype(str).str.strip())
    return (end - start) // resolution + 1


def _count_records(
    dataset, profiles, profile_variable_list, count_variables, eov_variables,
    logger,
):
    time_min = ERDDAP.parse_erddap_date(profiles["time_min"].min())
    time_max = ERDDAP.parse_erddap_date(profiles["time_max"].max())
    profile_count = dataset.get_count(
        sorted(set(count_variables) | set(eov_variables)),
        profile_variable_list,
        time_min,
        time_max,
    )
    if profile_count.empty and eov_variables:
        # The widened request can fail where the narrow one succeeds; never
        # lose a dataset over EOV detection.
        logger.warning("Count including EOV variables failed, retrying without them")
        eov_variables = {}
        profile_count = dataset.get_count(
            count_variables, profile_variable_list, time_min, time_max
        )

    if not profile_count.empty:
        profile_count = profile_count.set_index(profile_variable_list)
        # n_records counts records, so the EOV columns must not feed it.
        n_records_columns = [
            column for column in count_variables if column in profile_count.columns
        ]
        profiles["n_records"] = profile_count[n_records_columns].max(axis="columns")
        profiles["eovs"] = _eovs_per_feature(
            profile_count, eov_variables, dataset.eovs
        )
    return profiles


def _feature_ids(profiles):
    columns = [c for c in ("timeseries_id", "profile_id") if c in profiles]
    if not columns:
        return []
    labels = profiles[columns].astype(str).agg(
        lambda row: "/".join(v for v in row if v), axis="columns"
    )
    return labels[labels != ""].drop_duplicates().tolist()


def extract_features(dataset, handler):
    """Single-feature datasets use metadata (actual_range) where possible: ONC
    can't answer per-profile min/max but only publishes one profile per
    dataset."""
    vertical_variables = ["depth", "altitude"]

    # lat/lon are excluded: their separate minimums could be a point not in
    # the dataset.
    llat_variables = [
        "depth",
        "altitude",
        "time",
    ]
    llat_variables_in_dataset = [
        x for x in llat_variables if x in dataset.variables_list
    ]

    identity = dataset.get_profile_ids(
        collapse_time_profile_ids=handler.collapse_time_profile_ids
    )

    if identity.empty:
        return identity

    # Subset-table positions only feed the bounding box below.
    profiles_with_lat_lon = identity.drop(
        columns=["latitude", "longitude"], errors="ignore"
    ).drop_duplicates()
    profiles = profiles_with_lat_lon.copy()
    # e.g. {'profile_id': 'hakai_id', 'timeseries_id': 'station'}
    profile_variables = dataset.profile_variables

    profile_variable_list = dataset.profile_variable_list

    if profiles.empty:
        return profiles
    logger = dataset.logger
    logger.debug(f"Found {len(profiles)} profiles")

    profiles_with_lat_lon, profile_variables, profile_variable_list = (
        handler.adjust_feature_identity(
            dataset, profiles_with_lat_lon, profiles, profile_variables,
            profile_variable_list,
        )
    )

    if "profile_id" in profile_variables:
        profiles_with_lat_lon["n_profiles"] = 1

    profiles_with_lat_lon = profiles_with_lat_lon.set_index(profile_variable_list)

    for llat_variable in llat_variables_in_dataset:
        if llat_variable in profile_variable_list:
            val = profiles_with_lat_lon.index.get_level_values(llat_variable)
            profiles_with_lat_lon[llat_variable + "_min"] = val
            profiles_with_lat_lon[llat_variable + "_max"] = val
            continue
        elif llat_variable + "_min" in profiles_with_lat_lon:
            continue
        elif len(profiles) == 1 and (
            metadata_range := _range_from_metadata(dataset, llat_variable)
        ):
            logger.debug(f"Using dataset metadata for {llat_variable}")

            [min, max] = metadata_range

            if "NaN" in max:
                max = datetime.now(UTC).isoformat()
                # The listing's maxTime is empty for an ongoing feed (ONC's
                # open deployments), so it can't feed dataset_is_realtime().
                if llat_variable == "time":
                    dataset.coverage_time_max = max

            if llat_variable in vertical_variables:
                min = float(min)
                max = float(max)

            profiles_with_lat_lon[llat_variable + "_min"] = min
            profiles_with_lat_lon[llat_variable + "_max"] = max
            continue
        else:
            variables = profile_variable_list + [llat_variable]
            profile_min_max = dataset.get_max_min(variables)

            if profile_min_max.empty:
                logger.error(f"No data found for  {dataset.id}")
                dataset.no_features_reason = (
                    f"orderByMinMax of {llat_variable} per feature returned no "
                    f"rows: {llat_variable} is never filled"
                )
                return profile_min_max

        profiles_with_lat_lon = profiles_with_lat_lon.join(profile_min_max)

    box = _lat_lon_box(dataset, profiles, profile_variable_list, logger, identity)
    if box.empty:
        logger.error(f"No lat/lon data found for {dataset.id}")
        dataset.no_features_reason = (
            "No latitude/longitude values per feature: the per-feature min/max "
            "query returned no rows"
        )
        return box

    profiles_with_lat_lon = profiles_with_lat_lon.join(box)

    classified = profiles_with_lat_lon.apply(
        lambda r: classify_profile_location(
            r["latitude_min"], r["latitude_max"],
            r["longitude_min"], r["longitude_max"],
        ),
        axis="columns",
        result_type="expand",
    )
    profiles_with_lat_lon[["latitude", "longitude", "show_as_point"]] = classified
    profiles_with_lat_lon = profiles_with_lat_lon.dropna(
        subset=["latitude", "longitude"]
    )
    if profiles_with_lat_lon.empty:
        dataset.no_features_reason = "Every feature has a missing latitude or longitude"
    # result_type="expand" leaves this object-typed and nothing coerces it later.
    profiles_with_lat_lon["show_as_point"] = profiles_with_lat_lon[
        "show_as_point"
    ].astype(bool)

    profiles = profiles_with_lat_lon

    logger.debug("Get record Count")
    count_variables = profile_variable_list.copy()

    count_variables.append("time")

    if "depth" in dataset.variables_list:
        count_variables.append("depth")

    profiles = profiles.query(
        "(not time_min.isnull()) and not (time_max.isnull())"
    ).copy()

    count_variables = sorted(set(count_variables))

    # EOV variables ride along in the count request to tell which EOVs each
    # feature holds. Skipped for a single feature: its EOVs are the dataset's,
    # and get_count's 30-day window there cannot answer EOV presence.
    is_single_feature = len(dataset.profile_ids) <= 1 or len(profiles) <= 1
    eov_variables = {} if is_single_feature else dataset.get_eov_variables()

    # Counting is the costliest scan, so the cheapest answer wins:
    #   1. time_coverage_resolution: no request, at the price of span-based day
    #      sets and dataset-wide EOVs;
    #   2. one per-day orderByCount (multi-day feature types only);
    #   3. a plain per-feature orderByCount.
    resolution = _time_resolution(dataset)
    day_sets = None
    if handler.features_span_multiple_days and resolution is not None:
        logger.debug("Using time_coverage_resolution for the record count")
        timesteps = _timesteps(profiles, resolution)
        profiles["n_records"] = timesteps * handler.rows_per_timestep(
            dataset, profiles, profile_variable_list
        )
        profiles["eovs"] = [list(dataset.eovs)] * len(profiles)
    elif handler.features_span_multiple_days:
        day_sets = _extract_day_sets(
            dataset, profiles, profile_variable_list, logger,
            record_variables=[v for v in ("depth",) if v in dataset.variables_list],
            eov_variables=list(eov_variables),
        )

    if day_sets is not None:
        profiles = profiles.join(day_sets[["day_ranges", "days", "n_records"]])
        profiles["eovs"] = _eovs_per_feature(day_sets, eov_variables, dataset.eovs)
    elif "n_records" not in profiles:
        if dataset.id in dataset.erddap_server.gateway_timeouts:
            # The harvester retries the whole dataset once ERDDAP has cached it.
            logger.warning("Gateway timeout while counting; deferring the dataset")
            dataset.no_features_reason = (
                "ERDDAP timed out (504) while counting records, again after a retry"
            )
            return pd.DataFrame()
        profiles = _count_records(
            dataset, profiles, profile_variable_list, count_variables,
            eov_variables, logger,
        )

    if "n_records" not in profiles:
        profiles["n_records"] = None
    if "eovs" not in profiles:
        profiles["eovs"] = [list(dataset.eovs)] * len(profiles)

    profiles = profiles.query("not n_records.isnull()")

    if profiles.empty:
        logger.error("Error counting records")
        dataset.no_features_reason = (
            "The record-count query returned no counts for any feature"
        )
        return profiles

    profiles = profiles.reset_index(drop=False).copy()

    profiles.rename(
        columns={value: key for key, value in profile_variables.items()}, inplace=True
    )

    profiles["time_min"] = ERDDAP.parse_erddap_dates(profiles["time_min"])
    profiles["time_max"] = ERDDAP.parse_erddap_dates(profiles["time_max"])
    # e.g. year 0019 coerces to NaT; dropped here so an emptied dataset is
    # skipped as NO_PROFILES_FOUND rather than loaded.
    unparseable_time = profiles["time_min"].isna() | profiles["time_max"].isna()
    if unparseable_time.any():
        dataset.warnings.add(
            FEATURES_DROPPED,
            f"{int(unparseable_time.sum())} of {len(profiles)} features removed: "
            "unparseable time",
            items=_feature_ids(profiles[unparseable_time]),
            count=int(unparseable_time.sum()),
        )
        profiles = profiles[~unparseable_time].copy()
        if profiles.empty:
            return profiles
    profiles["dataset_id"] = dataset.id
    profiles["erddap_url"] = dataset.erddap_url

    if "altitude" in dataset.variables_list:
        profiles["altitude_min"] = -profiles["altitude_min"]
        profiles["altitude_max"] = -profiles["altitude_max"]
        profiles = profiles.rename(
            {
                "depth_min": "altitude_min",
                "depth_max": "altitude_max",
            }
        )

    if "depth_min" not in profiles:
        profiles["depth_min"] = 0
        profiles["depth_max"] = 0

    profiles["depth_min"].fillna(0, inplace=True)
    profiles["depth_max"].fillna(0, inplace=True)

    if "profile_id" not in profiles:
        profiles["profile_id"] = ""

    if "timeseries_id" not in profiles:
        profiles["timeseries_id"] = ""

    cols_to_convert = ["latitude", "longitude"]

    profiles[cols_to_convert] = profiles[cols_to_convert].apply(
        pd.to_numeric, errors="coerce"
    )
    # records_per_day is a rate over days that HAVE data: the download estimator
    # pairs it with day_range_overlap_days (web-api/utils/shapeQuery.js).
    span_days = (profiles["time_max"] - profiles["time_min"]).dt.days
    # a start and end on the same day is one day of data, not zero
    span_days = span_days.replace(0, 1)

    if "days" in profiles:
        profiles["days"] = profiles["days"].fillna(span_days).replace(0, 1)
    else:
        profiles["days"] = span_days

    profiles["records_per_day"] = profiles["n_records"] / profiles["days"]

    # Empty means "day set unknown"; the web-api falls back to the row's span.
    if "day_ranges" not in profiles:
        profiles["day_ranges"] = [[] for _ in range(len(profiles))]
    profiles["day_ranges"] = profiles["day_ranges"].apply(
        lambda runs: list(runs) if isinstance(runs, (list, tuple)) else []
    )

    profiles = profiles.round(4)

    profiles_bad_geom_query = """((latitude <= -90) or (latitude >= 90) or  \
                                (longitude <= -180) or (longitude >= 180) or  \
                                (depth_max > 15000) or (depth_min < -100)) or \
                                records_per_day.isnull()
                              """
    profiles_bad_geom = profiles.query(profiles_bad_geom_query)

    if not profiles_bad_geom.empty:
        dataset.warnings.add(
            FEATURES_DROPPED,
            f"{len(profiles_bad_geom)} of {len(profiles)} features removed: "
            "latitude/longitude out of range, depth outside -100..15000 m, "
            "or no record count",
            items=_feature_ids(profiles_bad_geom),
            count=len(profiles_bad_geom),
        )
        profiles = profiles.query("not " + profiles_bad_geom_query)

    return profiles
