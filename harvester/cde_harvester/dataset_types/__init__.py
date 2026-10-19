"""Registry of ERDDAP dataset-type handlers; register() a new
DatasetTypeHandler below to support another cdm_data_type."""

from cde_harvester.dataset_types.base import DatasetTypeHandler

_REGISTRY: "dict[str, DatasetTypeHandler]" = {}


def register(handler: DatasetTypeHandler) -> None:
    _REGISTRY[handler.cdm_data_type] = handler


def get_handler(cdm_data_type):
    return _REGISTRY.get(cdm_data_type)


def supported_cdm_data_types():
    return list(_REGISTRY)


def supported_data_structures():
    return tuple(dict.fromkeys(h.data_structure for h in _REGISTRY.values()))


def extract_features(dataset):
    handler = get_handler(dataset.cdm_data_type)
    if handler is None:
        raise KeyError(
            f"No dataset-type handler registered for cdm_data_type="
            f"{dataset.cdm_data_type!r} (supported: {supported_cdm_data_types()})"
        )
    return handler.extract_features(dataset)


def feature_kind_for(cdm_data_type):
    """Which HarvestResult attribute this type's features land in."""
    handler = get_handler(cdm_data_type)
    return handler.feature_kind if handler else "profiles"


def extract_track_points(dataset):
    """Call after extract_features(): the trajectory extraction relies on the
    CF-role variables it resolves."""
    handler = get_handler(dataset.cdm_data_type)
    if handler is None:
        return None
    return handler.extract_track_points(dataset)


# Default registrations. Order matters for reproducible skip messages: it is
# the order supported_cdm_data_types() reports.
from cde_harvester.dataset_types.grid import GridHandler  # noqa: E402
from cde_harvester.dataset_types.profile import ProfileHandler  # noqa: E402
from cde_harvester.dataset_types.timeseries import TimeSeriesHandler  # noqa: E402
from cde_harvester.dataset_types.timeseries_profile import (  # noqa: E402
    TimeSeriesProfileHandler,
)
from cde_harvester.dataset_types.trajectory import (  # noqa: E402
    TrajectoryHandler,
    TrajectoryProfileHandler,
)

register(TimeSeriesHandler())
register(ProfileHandler())
register(TimeSeriesProfileHandler())
register(TrajectoryHandler())
register(TrajectoryProfileHandler())
register(GridHandler())
