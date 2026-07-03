"""Handlers for cdm_data_type=Trajectory and TrajectoryProfile.

Moving-platform datasets (gliders, drifters, ships underway). Features are
coverage cells (see trajectory_features), not per-profile points, so
feature_kind routes them into HarvestResult.trajectory_cells /
cde.trajectory_cells instead of the profiles table.

Each dataset additionally yields coverage-corridor footprint rows
(trajectory_footprints, built from decimated points when the server supports
orderByClosest, else from the cells) — stashed on the dataset object and
picked up by harvest_dataset() into HarvestResult.trajectory_footprints.
"""

import pandas as pd

from cde_harvester.dataset_types import (
    trajectory_features,
    trajectory_footprints,
    trajectory_points,
)
from cde_harvester.dataset_types.base import DatasetTypeHandler


def _extract_cells_and_footprints(dataset, count_profiles):
    cells = trajectory_features.extract_cells(dataset, count_profiles=count_profiles)
    if cells.empty:
        dataset.trajectory_footprints = pd.DataFrame(
            columns=trajectory_footprints.FOOTPRINT_COLUMNS
        )
        return cells
    points, _interval = trajectory_points.extract_points(dataset, cells)
    dataset.trajectory_footprints = trajectory_footprints.build_footprints(
        dataset, cells, points
    )
    return cells


class TrajectoryHandler(DatasetTypeHandler):
    cdm_data_type = "Trajectory"
    feature_kind = "trajectory_cells"

    def extract_features(self, dataset):
        return _extract_cells_and_footprints(dataset, count_profiles=False)


class TrajectoryProfileHandler(DatasetTypeHandler):
    """Profiles along a track (glider dives). Emits coverage cells with a
    per-cell distinct-profile count — deliberately NOT per-profile rows in
    cde.profiles, which would explode to thousands of rows per mission."""

    cdm_data_type = "TrajectoryProfile"
    feature_kind = "trajectory_cells"

    def extract_features(self, dataset):
        return _extract_cells_and_footprints(dataset, count_profiles=True)
