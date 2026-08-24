"""DatasetTypeHandler — one strategy object per ERDDAP cdm_data_type.

All type-specific harvest logic lives in a handler: which listing structure
the type comes from (tabledap vs griddap), which HarvestResult attribute its
features land in, and how per-feature spatial/temporal extents are extracted.
Adding support for a new cdm_data_type (e.g. Trajectory) means writing one
handler module and registering it in ``dataset_types/__init__.py`` — no edits
to the harvester, the listing filter or the shared feature pipeline.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass

import pandas as pd


@dataclass
class DatasetQualityReport:
    """Why a dataset failed structural QC, written for the ERDDAP admin.

    ``details`` is prose aimed at whoever can fix the dataset, not at us: it
    states the finding, the evidence that produced it and the metadata change
    that would resolve it. It lands in cde.harvest_attempts.error_message,
    which the harvest dashboard shows alongside the query_urls that prove it.
    """

    reason_code: str
    details: str


class DatasetTypeHandler(ABC):
    # Exact allDatasets cdm_data_type value, e.g. "TimeSeriesProfile".
    cdm_data_type: str
    # ERDDAP dataStructure this type is listed under: "table" | "grid".
    data_structure: str = "table"
    # HarvestResult attribute the extracted features land in
    # ("profiles" for point-like types, "trajectory_days" for trajectories).
    feature_kind: str = "profiles"

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

    def validate(self, dataset):
        """Hook: structural QC beyond metadata compliance. Default = accept.

        CDEComplianceChecker asks "does this dataset declare what we need?".
        This asks the harder question "does the DATA match the geometry the
        dataset declares?", which needs queries and so cannot live in the
        metadata-only checker. Return None to accept, or a DatasetQualityReport
        to skip the dataset with an admin-facing explanation.

        Only Point overrides this today: it is ERDDAP's default cdm_data_type,
        so unlike the types an admin had to opt into, it cannot be taken at its
        word. Runs after passes_all_checks() and before extract_features().
        """
        return None
