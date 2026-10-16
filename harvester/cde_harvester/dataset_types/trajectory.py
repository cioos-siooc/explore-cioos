"""Handlers for cdm_data_type=Trajectory and TrajectoryProfile: per-day
aggregates, positioned on the map only via the track points."""

from cde_harvester.dataset_types import trajectory_features
from cde_harvester.dataset_types.base import DatasetTypeHandler


class TrajectoryHandler(DatasetTypeHandler):
    cdm_data_type = "Trajectory"
    feature_kind = "trajectory_days"

    def extract_features(self, dataset):
        return trajectory_features.extract_day_stats(dataset, count_profiles=False)

    def extract_track_points(self, dataset):
        return trajectory_features.extract_track_points(dataset, per_profile=False)


class TrajectoryProfileHandler(DatasetTypeHandler):
    """Deliberately NOT per-profile rows in cde.profiles, which would explode
    to thousands of rows per mission."""

    cdm_data_type = "TrajectoryProfile"
    feature_kind = "trajectory_days"

    def extract_features(self, dataset):
        return trajectory_features.extract_day_stats(dataset, count_profiles=True)

    def extract_track_points(self, dataset):
        # Reuses the request extract_day_stats already made.
        return trajectory_features.extract_track_points(dataset, per_profile=True)
