"""Handlers for cdm_data_type=Trajectory and TrajectoryProfile.

Moving-platform datasets (gliders, drifters, ships underway). Features are
per-day aggregates (see trajectory_features), not per-profile points, so
feature_kind routes them into HarvestResult.trajectory_days /
cde.trajectory_days instead of the profiles table. Their position on the map
comes from the track points, which the database sweeps through the hex grid.
"""

from cde_harvester.dataset_types import trajectory_features
from cde_harvester.dataset_types.base import DatasetTypeHandler


class TrajectoryHandler(DatasetTypeHandler):
    cdm_data_type = "Trajectory"
    feature_kind = "trajectory_days"

    def extract_features(self, dataset):
        return trajectory_features.extract_day_stats(dataset, count_profiles=False)

    def extract_track_points(self, dataset):
        # The coverage geometry: downsampled ordered positions for
        # cde.trajectory_points (track lines + the hex sweep).
        return trajectory_features.extract_track_points(dataset, per_profile=False)


class TrajectoryProfileHandler(DatasetTypeHandler):
    """Profiles along a track (glider dives). Emits per-day aggregates with a
    distinct-profile count — deliberately NOT per-profile rows in
    cde.profiles, which would explode to thousands of rows per mission."""

    cdm_data_type = "TrajectoryProfile"
    feature_kind = "trajectory_days"

    def extract_features(self, dataset):
        return trajectory_features.extract_day_stats(dataset, count_profiles=True)

    def extract_track_points(self, dataset):
        # One fix per profile (full fidelity at Argo cadence), reusing the
        # request extract_day_stats already made.
        return trajectory_features.extract_track_points(dataset, per_profile=True)
