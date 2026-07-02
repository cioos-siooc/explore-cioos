"""Registry of ERDDAP dataset-type handlers.

The registry drives both the allDatasets listing filter (via
``supported_data_structures()``) and the per-dataset cdm_data_type allowlist
(via ``supported_cdm_data_types()``). To support a new type, write a
:class:`~cde_harvester.dataset_types.base.DatasetTypeHandler` subclass and
``register()`` it below — nothing else needs to change.
"""

from cde_harvester.dataset_types.base import DatasetTypeHandler

_REGISTRY: "dict[str, DatasetTypeHandler]" = {}


def register(handler: DatasetTypeHandler) -> None:
    _REGISTRY[handler.cdm_data_type] = handler


def get_handler(cdm_data_type):
    return _REGISTRY.get(cdm_data_type)


def supported_cdm_data_types():
    """Allowlist of cdm_data_type values the pipeline can harvest."""
    return list(_REGISTRY)


def supported_data_structures():
    """ERDDAP allDatasets dataStructure values to list ("table" and/or "grid")."""
    return tuple(dict.fromkeys(h.data_structure for h in _REGISTRY.values()))


def extract_features(dataset):
    """Dispatch feature extraction to the handler for this dataset's type."""
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


# Default registrations. Order matters for reproducible skip messages: it is
# the order supported_cdm_data_types() reports.
from cde_harvester.dataset_types.timeseries import TimeSeriesHandler  # noqa: E402
from cde_harvester.dataset_types.profile import ProfileHandler  # noqa: E402
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
