"""DatasetTypeHandler — one strategy object per ERDDAP cdm_data_type."""

from abc import ABC, abstractmethod

import pandas as pd


class DatasetTypeHandler(ABC):
    cdm_data_type: str
    # "table" | "grid"
    data_structure: str = "table"
    # HarvestResult attribute the extracted features land in
    # ("profiles" for point-like types, "trajectory_days" for trajectories).
    feature_kind: str = "profiles"
    # True costs one extra grouped request per dataset to harvest the day set;
    # for single-cast types the database fills `days` from [time_min, time_max].
    features_span_multiple_days: bool = False
    # Whether a cf_role=profile_id on `time` is dropped before enumerating
    # features, identifying them by their other cf_role variables only.
    collapse_time_profile_ids: bool = False

    @abstractmethod
    def extract_features(self, dataset) -> pd.DataFrame:
        """ProfileSchema-shaped rows for point-like types, TrajectoryDaySchema
        rows (per-day aggregates, no position) for trajectories."""

    def adjust_feature_identity(
        self, dataset, profiles_with_lat_lon, profiles, profile_variables,
        profile_variable_list,
    ):
        """Reshape the raw CF-role identity frame before min/max extraction."""
        return profiles_with_lat_lon, profile_variables, profile_variable_list

    def rows_per_timestep(self, dataset, profiles, profile_variable_list):
        """Records one ``time_coverage_resolution`` timestep holds, per feature
        (a scalar or a Series aligned to ``profiles``)."""
        return 1

    def extract_track_points(self, dataset):
        """Ordered, downsampled track fixes (TrajectoryPointSchema) that the
        database also sweeps into hex coverage; runs AFTER extract_features."""
        return None
