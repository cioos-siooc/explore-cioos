"""Shared tabledap feature pipeline.

The per-profile min/max/count extraction that all point-like ERDDAP dataset
types (TimeSeries, Profile, TimeSeriesProfile) run. Type-specific identity
reshaping is delegated to the handler's ``adjust_feature_identity`` hook —
this module contains no cdm_data_type branches.
"""

from datetime import datetime

import pandas as pd
from cde_harvester.dataset_types.geo import classify_profile_location
from cde_harvester.sources.erddap.client import ERDDAP


def _axis_bounds_from_metadata(dataset, axis):
    """(min, max) for ``latitude``/``longitude`` from a single-feature
    dataset's metadata: the variable's ``actual_range``, else the
    ``geospatial_*`` globals. Returns None when neither is usable.

    Lets single-feature datasets skip the two orderByMinMax queries entirely,
    mirroring how the time/depth min/max uses actual_range.
    """
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


def _eovs_per_feature(profile_count, eov_variables, dataset_eovs):
    """Per-feature EOV lists as a Series aligned to ``profile_count``'s index.

    A feature carries an EOV when at least one variable mapped to that EOV has
    a non-zero record count for it. Per-variable EOVs are by construction a
    subset of the dataset's, so a feature's list never exceeds the dataset's.

    A feature with no non-zero counts falls back to the dataset's EOVs rather
    than getting an empty list: the web-api filters with a PostgreSQL array
    overlap, so an empty list would silently hide the feature from every EOV
    selection.
    """
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


def _lat_lon_box(dataset, profiles, profile_variable_list, logger):
    """Per-feature lat/lon bounding box, indexed by ``profile_variable_list``
    with columns latitude_min/max, longitude_min/max.

    Single-feature datasets use metadata (no query); otherwise two bounded
    orderByMinMax queries (one per axis). Returns an empty frame on failure.
    """
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

    lat_mm = dataset.get_max_min(profile_variable_list + ["latitude"])
    lon_mm = dataset.get_max_min(profile_variable_list + ["longitude"])
    if lat_mm.empty or lon_mm.empty:
        return pd.DataFrame()
    return lat_mm.join(lon_mm)


def extract_features(dataset, handler):
    """
    Get max/min stats for each profile in a dataset

    if there's only a single profile, use actual_range when possible

    For ONC we can't get max min values for profiles but we can get it for the entire dataset. This works because
    they only use one profile per dataset

    llat_variables_in_dataset is any of time, depth variables that exist in this dataset

    Example of profile_variable is: {'profile_id': 'hakai_id', 'timeseries_id': 'station'}


    """

    df_variables = dataset.df_variables

    vertical_variables = ["depth", "altitude"]

    # lat,lon not in this list. They have to be treated differently as getting the min of the lat and lon could create a point not in the dataset
    llat_variables = [
        "depth",
        "altitude",
        "time",
    ]
    llat_variables_in_dataset = [
        x for x in llat_variables if x in dataset.variables_list
    ]

    profiles_with_lat_lon = dataset.get_profile_ids()

    if profiles_with_lat_lon.empty:
        return profiles_with_lat_lon

    profiles = profiles_with_lat_lon[
        profiles_with_lat_lon.columns.difference(["latitude", "longitude"])
    ].drop_duplicates()
    # Organize dataset variables by their cf_roles
    # eg profile_variable={'profile_id': 'hakai_id', 'timeseries_id': 'station'}
    profile_variables = dataset.profile_variables

    # Profile Variable List - list of dataset variables that have cf_roles attached to them
    profile_variable_list = dataset.profile_variable_list

    if profiles.empty:
        return profiles
    logger = dataset.logger
    logger.debug(f"Found {len(profiles)} profiles")

    # Type-specific identity reshaping (e.g. TimeSeriesProfile's collapse to
    # timeseries when there are too many profiles per timeseries).
    profiles_with_lat_lon, profile_variables, profile_variable_list = (
        handler.adjust_feature_identity(
            dataset, profiles_with_lat_lon, profiles, profile_variables,
            profile_variable_list,
        )
    )

    if "profile_id" in profile_variables:
        # if subseted by profile_id there's only one per profile
        profiles_with_lat_lon["n_profiles"] = 1

    # Start profiles table
    profiles_with_lat_lon = profiles_with_lat_lon.set_index(profile_variable_list)

    for llat_variable in llat_variables_in_dataset:
        # lat,lon have been removed. They are treated differently as it doesn't work to treat lat and lon separately
        if llat_variable in profile_variable_list:
            # If this variable is already use to distinqguish individual profiles just copy their values
            val = profiles_with_lat_lon.index.get_level_values(llat_variable)
            profiles_with_lat_lon[llat_variable + "_min"] = val
            profiles_with_lat_lon[llat_variable + "_max"] = val
            continue
        # if this dataset is a single profile and actual_range is set, use that
        elif len(profiles) == 1 and df_variables.loc[llat_variable].get("actual_range"):
            # if this dataset is a single profile and actual_range is set, use that
            logger.debug(f"Using dataset actual_range for {llat_variable}")

            [min, max] = df_variables.loc[llat_variable]["actual_range"].split(",")

            # For ongoing datasets
            if "NaN" in max:
                max = datetime.utcnow().isoformat()

            if llat_variable in vertical_variables:
                min = float(min)
                max = float(max)

            profiles_with_lat_lon[llat_variable + "_min"] = min
            profiles_with_lat_lon[llat_variable + "_max"] = max
            continue
        else:
            variables = profile_variable_list + [llat_variable]
            profile_min_max = dataset.get_max_min(variables)

            # Something went wrong
            if profile_min_max.empty:
                logger.error(f"No data found for  {dataset.id}")
                return profile_min_max

        profiles_with_lat_lon = profiles_with_lat_lon.join(profile_min_max)

    # Per-feature lat/lon bounding box. Kept separate from the llat loop above:
    # lat/lon don't become standalone _min/_max display columns, they combine
    # into one representative point (exact, or box midpoint) plus a stored bbox
    # used by spatial search. The min of lat and min of lon separately can be a
    # point not in the dataset, so we never treat them as a location on their
    # own — only as box extents + a derived midpoint.
    box = _lat_lon_box(dataset, profiles, profile_variable_list, logger)
    if box.empty:
        logger.error(f"No lat/lon data found for {dataset.id}")
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
    # Drop features whose box had null coordinates (classify returns nan point).
    profiles_with_lat_lon = profiles_with_lat_lon.dropna(
        subset=["latitude", "longitude"]
    )
    # result_type="expand" leaves these object-typed; the DB columns are
    # double precision / boolean. lat/lon are re-coerced below with the rest,
    # but the bool has no later coercion, so fix it here.
    profiles_with_lat_lon["show_as_point"] = profiles_with_lat_lon[
        "show_as_point"
    ].astype(bool)

    profiles = profiles_with_lat_lon

    # Get Count for each dataset
    # First identify variables to use
    logger.debug("Get record Count")
    count_variables = profile_variable_list.copy()

    count_variables.append("time")

    if "depth" in dataset.variables_list:
        count_variables.append("depth")

    # Retrieve Count value per profile
    profiles = profiles.query(
        "(not time_min.isnull()) and not (time_max.isnull())"
    ).copy()

    time_min = ERDDAP.parse_erddap_date(profiles["time_min"].min())
    time_max = ERDDAP.parse_erddap_date(profiles["time_max"].max())

    count_variables = sorted(list(set(count_variables)))

    # Variables carrying an EOV are counted per feature as well: ERDDAP's
    # orderByCount answers with one non-null count column per requested
    # variable, so the request already being made also tells us which of the
    # dataset's EOVs each feature actually holds.
    #
    # A single-feature dataset is skipped: its one feature is the dataset, so
    # its EOVs are the dataset's. That also sidesteps get_count's two shortcuts
    # (time_coverage_resolution, 30-day extrapolation), which only fire for
    # single-feature datasets and return a time-only or window-limited frame
    # that cannot answer EOV presence.
    is_single_feature = len(dataset.profile_ids) <= 1 or len(profiles) <= 1
    eov_variables = {} if is_single_feature else dataset.get_eov_variables()

    profile_count = dataset.get_count(
        sorted(set(count_variables) | set(eov_variables)),
        profile_variable_list,
        time_min,
        time_max,
    )
    if profile_count.empty and eov_variables:
        # The widened request can fail where the narrow one succeeds (longer
        # URL, larger response). Never lose a dataset over EOV detection: redo
        # the original request and fall back to the dataset's EOVs.
        logger.warning("Count including EOV variables failed, retrying without them")
        eov_variables = {}
        profile_count = dataset.get_count(
            count_variables, profile_variable_list, time_min, time_max
        )

    if not profile_count.empty:
        profile_count = profile_count.set_index(profile_variable_list)
        # n_records counts records, not variables: it has to keep ranging over
        # the same columns it did before the EOV columns joined the request.
        n_records_columns = [
            column for column in count_variables if column in profile_count.columns
        ]
        profiles["n_records"] = profile_count[n_records_columns].max(axis="columns")
        profiles["eovs"] = _eovs_per_feature(
            profile_count, eov_variables, dataset.eovs
        )
    if not "n_records" in profiles:
        profiles["n_records"] = None
    if not "eovs" in profiles:
        profiles["eovs"] = [list(dataset.eovs)] * len(profiles)

    # something went wrong with counting records
    profiles = profiles.query("not n_records.isnull()")

    if profiles.empty:
        logger.error("Error counting records")
        return profiles

    profiles = profiles.reset_index(drop=False).copy()

    # Rename cf_role variables as cf_role and drop from index.
    # Eg rename 'station_id' to 'timeseries_id'
    # del profiles["STN_ID"]
    profiles.rename(
        columns={value: key for key, value in profile_variables.items()}, inplace=True
    )

    # Convert time variables and add dataset_id so the records can be linked to dataset in the DB
    profiles["time_min"] = ERDDAP.parse_erddap_dates(profiles["time_min"])
    profiles["time_max"] = ERDDAP.parse_erddap_dates(profiles["time_max"])
    profiles["dataset_id"] = dataset.id
    profiles["erddap_url"] = dataset.erddap_url

    # special case
    if "altitude" in dataset.variables_list:
        profiles["altitude_min"] = -profiles["altitude_min"]
        profiles["altitude_max"] = -profiles["altitude_max"]
        profiles = profiles.rename(
            {
                "depth_min": "altitude_min",
                "depth_max": "altitude_max",
            }
        )

    # if depth isnt a variable, set it to 0
    if "depth_min" not in profiles:
        profiles["depth_min"] = 0
        profiles["depth_max"] = 0

    profiles["depth_min"].fillna(0, inplace=True)
    profiles["depth_max"].fillna(0, inplace=True)

    if not "profile_id" in profiles:
        profiles["profile_id"] = ""

    if not "timeseries_id" in profiles:
        profiles["timeseries_id"] = ""

    cols_to_convert = ["latitude", "longitude"]

    profiles[cols_to_convert] = profiles[cols_to_convert].apply(
        pd.to_numeric, errors="coerce"
    )
    # calculate records_per_day
    days = (profiles["time_max"] - profiles["time_min"]).dt.days

    # if the start and end date is same day
    days = days.replace(0, 1)

    profiles["records_per_day"] = profiles["n_records"] / (days)

    profiles = profiles.round(4)

    profiles_bad_geom_query = f"""((latitude <= -90) or (latitude >= 90) or  \
                                (longitude <= -180) or (longitude >= 180) or  \
                                (depth_max > 15000) or (depth_min < -100)) or \
                                records_per_day.isnull()
                              """
    #    or \
    # time_min > '{datetime.now(pytz.utc)}' or \
    # time_max > '{datetime.now(pytz.utc)}')
    profiles_bad_geom = profiles.query(profiles_bad_geom_query)

    if not profiles_bad_geom.empty:
        logger.warn(
            "These profiles with bad lat/long/depth/time values will be removed:"
        )
        # TODO this could use record_id if it existed
        logger.warn(set(profiles_bad_geom["profile_id"].to_list()))
        logger.warn(set(profiles_bad_geom["timeseries_id"].to_list()))

        profiles = profiles.query("not " + profiles_bad_geom_query)

    return profiles
