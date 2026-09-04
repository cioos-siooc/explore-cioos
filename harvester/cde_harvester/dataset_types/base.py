"""DatasetTypeHandler — one strategy object per ERDDAP cdm_data_type.

All type-specific harvest logic lives in a handler: which listing structure
the type comes from (tabledap vs griddap), which HarvestResult attribute its
features land in, and how per-feature spatial/temporal extents are extracted.
Adding support for a new cdm_data_type (e.g. Trajectory) means writing one
handler module and registering it in ``dataset_types/__init__.py`` — no edits
to the harvester, the listing filter or the shared feature pipeline.
"""

from abc import ABC, abstractmethod

import pandas as pd


class DatasetTypeHandler(ABC):
    # Exact allDatasets cdm_data_type value, e.g. "TimeSeriesProfile".
    cdm_data_type: str
    # ERDDAP dataStructure this type is listed under: "table" | "grid".
    data_structure: str = "table"
    # HarvestResult attribute the extracted features land in
    # ("profiles" for point-like types, "trajectory_days" for trajectories).
    feature_kind: str = "profiles"
    # Whether a feature of this type can span more than one UTC day, and so
    # needs its day SET harvested (one extra grouped request per dataset — see
    # tabledap_features._extract_day_sets). False for single-cast types, where
    # the [time_min, time_max] span already IS the day set and the database
    # fills `days` from it.
    features_span_multiple_days: bool = False

    @abstractmethod
    def extract_features(self, dataset) -> pd.DataFrame:
        """Per-feature spatial/temporal min-max frame for this dataset.

        Point-like types return ProfileSchema-shaped rows (one lat/lon per
        feature); trajectory types return TrajectoryDaySchema-shaped rows
        (per-day aggregates, no position — see trajectory_features).
        """

    def adjust_feature_identity(
        self, dataset, profiles_with_lat_lon, profiles, profile_variables,
        profile_variable_list,
    ):
        """Hook: reshape the raw CF-role identity frame before min/max
        extraction. Default = no-op. TimeSeriesProfile overrides this with
        its collapse-to-timeseries logic."""
        return profiles_with_lat_lon, profile_variables, profile_variable_list

    def extract_track_points(self, dataset):
        """Hook: secondary output — ordered, downsampled track fixes
        (TrajectoryPointSchema-shaped) for track-line rendering AND for the
        hex coverage the database sweeps from them. Default = None (no track
        output). Only the trajectory handlers override this; it runs AFTER
        extract_features for the same dataset."""
        return None
