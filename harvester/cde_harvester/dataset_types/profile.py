"""Handler for cdm_data_type=Profile (vertical casts)."""

from cde_harvester.dataset_types import tabledap_features
from cde_harvester.dataset_types.base import DatasetTypeHandler


class ProfileHandler(DatasetTypeHandler):
    cdm_data_type = "Profile"

    def extract_features(self, dataset):
        return tabledap_features.extract_features(dataset, self)
