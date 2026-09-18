"""
OBIS metadata enrichment against the CKAN catalogue snapshot.

CDE deliberately serves OBIS datasets that CKAN does not describe, so the
enrichment is a LEFT join with fallbacks and can never gate what is harvested.
These tests pin that: an unmatched dataset keeps its OBIS title and EOVs and
stays in the frame. The read path agrees — cde.datasets.ckan_id is only ever
concatenated into a link URL, so a NULL simply hides the link.
"""

import pandas as pd
from cde_harvester.sources.obis.harvester import OBISHarvester

MATCHED_UUID = "11111111-2222-3333-4444-555555555555"
UNMATCHED_UUID = "99999999-8888-7777-6666-555555555555"


def _catalogue(obis_ids):
    """A CKAN catalogue snapshot describing the given OBIS datasets."""
    return pd.DataFrame(
        [
            {
                "ckan_id": f"ckan-{i}",
                "ckan_name": f"record-{i}",
                "title": "A Catalogued Dataset",
                "title_fr": "Un jeu catalogué",
                "organizations": [],
                "eovs": ["seaSurfaceTemperature"],
                "erddap_url": None,
                "dataset_id": None,
                "obis_dataset_id": obis_id,
                "n_resources": 0,
            }
            for i, obis_id in enumerate(obis_ids)
        ]
    )


def _datasets(dataset_id):
    return pd.DataFrame(
        [{"dataset_id": dataset_id, "title": "OBIS Native Title", "eovs": []}]
    )


def _harvester(catalogue):
    return OBISHarvester(limit_dataset_ids=[MATCHED_UUID], ckan_catalogue=catalogue)


class TestObisWithoutCkanRecord:
    def test_dataset_survives_an_unrelated_catalogue(self):
        out = _harvester(_catalogue([UNMATCHED_UUID]))._enrich_with_ckan(
            _datasets(MATCHED_UUID)
        )
        assert list(out["dataset_id"]) == [MATCHED_UUID]

    def test_keeps_its_obis_title(self):
        out = _harvester(_catalogue([UNMATCHED_UUID]))._enrich_with_ckan(
            _datasets(MATCHED_UUID)
        )
        assert out.iloc[0]["title"] == "OBIS Native Title"

    def test_ckan_id_is_null_not_missing(self):
        # The column must exist: the db-loader writes it, and the web-api
        # concatenates it into ckan_url (NULL -> no link, row still served).
        out = _harvester(_catalogue([UNMATCHED_UUID]))._enrich_with_ckan(
            _datasets(MATCHED_UUID)
        )
        assert "ckan_id" in out.columns
        assert pd.isna(out.iloc[0]["ckan_id"])

    def test_survives_an_entirely_empty_catalogue(self):
        out = _harvester(pd.DataFrame())._enrich_with_ckan(_datasets(MATCHED_UUID))
        assert list(out["dataset_id"]) == [MATCHED_UUID]
        assert out.iloc[0]["title"] == "OBIS Native Title"

    def test_survives_no_catalogue_at_all(self):
        out = _harvester(None)._enrich_with_ckan(_datasets(MATCHED_UUID))
        assert list(out["dataset_id"]) == [MATCHED_UUID]


class TestObisWithCkanRecord:
    def test_matched_dataset_takes_the_ckan_title_and_eovs(self):
        out = _harvester(_catalogue([MATCHED_UUID]))._enrich_with_ckan(
            _datasets(MATCHED_UUID)
        )
        row = out.iloc[0]
        assert row["title"] == "A Catalogued Dataset"
        assert row["ckan_id"] == "ckan-0"
        assert row["eovs"] == ["seaSurfaceTemperature"]
