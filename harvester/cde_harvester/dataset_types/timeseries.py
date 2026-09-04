"""Handler for cdm_data_type=TimeSeries (fixed stations)."""

from cde_harvester.dataset_types import tabledap_features
from cde_harvester.dataset_types.base import DatasetTypeHandler


class TimeSeriesHandler(DatasetTypeHandler):
    cdm_data_type = "TimeSeries"

    def extract_features(self, dataset):
        return tabledap_features.extract_features(dataset, self)
