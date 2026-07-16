"""Handlers for cdm_data_type=Trajectory and TrajectoryProfile.

Moving-platform datasets (gliders, drifters, ships underway). Features are
coverage cells (see trajectory_features), not per-profile points, so
feature_kind routes them into HarvestResult.trajectory_cells /
cde.trajectory_cells instead of the profiles table.
"""

from cde_harvester.dataset_types import trajectory_features
from cde_harvester.dataset_types.base import DatasetTypeHandler


class TrajectoryHandler(DatasetTypeHandler):
    cdm_data_type = "Trajectory"
    feature_kind = "trajectory_cells"

    def extract_features(self, dataset):
        return trajectory_features.extract_cells(dataset, count_profiles=False)

    def extract_track_points(self, dataset):
        # Secondary output: first-fix-per-day ordered positions for
        # cde.trajectory_points (track-line rendering).
        return trajectory_features.extract_track_points(dataset, per_profile=False)


class TrajectoryProfileHandler(DatasetTypeHandler):
    """Profiles along a track (glider dives). Emits coverage cells with a
    per-cell distinct-profile count — deliberately NOT per-profile rows in
    cde.profiles, which would explode to thousands of rows per mission."""

    cdm_data_type = "TrajectoryProfile"
    feature_kind = "trajectory_cells"

    def extract_features(self, dataset):
        return trajectory_features.extract_cells(dataset, count_profiles=True)

    def extract_track_points(self, dataset):
        # Secondary output: one fix per profile (full fidelity at Argo
        # cadence) for cde.trajectory_points (track-line rendering).
        return trajectory_features.extract_track_points(dataset, per_profile=True)
