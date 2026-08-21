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
    # ("profiles" today; e.g. "trajectory_cells" for future cell-based types).
    feature_kind: str = "profiles"

    @abstractmethod
    def extract_features(self, dataset) -> pd.DataFrame:
        """Per-feature spatial/temporal min-max frame for this dataset.

        Point-like types return ProfileSchema-shaped rows (one lat/lon per
        feature); cell-like types (future trajectory hex bins) return their
        own cell schema.
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
        (TrajectoryPointSchema-shaped) for track-line rendering. Default =
        None (no track output). Only the trajectory handlers override this;
        it runs AFTER extract_features for the same dataset."""
        return None
