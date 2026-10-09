"""OBISHarvester's end-of-harvest metadata: the CKAN record when there is one,
otherwise the dataset's OBIS metadata converted by cioos-metadata-conversion."""

import os

import pandas as pd
import pytest
from cde_harvester.sources.ckan.create_ckan_obis_link import CKAN_OBIS_COLUMNS
from cde_harvester.sources.obis import harvester as obis_harvester
from cde_harvester.sources.obis.harvester import OBIS_SOURCE_URL, OBISHarvester

MATCHED = "11111111-1111-4111-8111-111111111111"
UNMATCHED = "22222222-2222-4222-8222-222222222222"

CONVERTED = {
    "eov": ["phytoplanktonBiomassAndDiversity"],
    "abstract": {"en": "An abstract", "fr": "Traduction française actuellement indisponible"},
}


def _metadata(dataset_id):
    return {"id": dataset_id, "url": f"https://ipt.example.org/ipt/resource?r={dataset_id}"}


def _ckan(*dataset_ids):
    return pd.DataFrame(
        [
            {"dataset_id": d, "ckan_id": f"ckan-{d}", "ckan_eovs": ["fishAbundanceAndDistribution"],
             "ckan_title": "CKAN title", "title_fr": "Titre CKAN"}
            for d in dataset_ids
        ],
        columns=CKAN_OBIS_COLUMNS,
    )


@pytest.fixture
def harvester(tmp_path, mocker):
    h = OBISHarvester(limit_dataset_ids=[MATCHED, UNMATCHED], folder=str(tmp_path))
    mocker.patch.object(h, "fetch_dataset_metadata", side_effect=_metadata)
    return h


def _enrich(h):
    datasets = pd.DataFrame(
        [{"dataset_id": d, "title": f"OBIS {d}", "eovs": []} for d in (MATCHED, UNMATCHED)]
    )
    return h._enrich_with_conversion(h._enrich_with_ckan(datasets)).set_index("dataset_id")


def test_ckan_lookup_gets_each_datasets_ipt_url(harvester, mocker):
    get = mocker.patch.object(obis_harvester, "get_ckan_obis_records", return_value=_ckan())
    mocker.patch.object(obis_harvester, "map_obis_to_cioos", return_value=CONVERTED)
    _enrich(harvester)
    get.assert_called_once_with(
        {d: _metadata(d)["url"] for d in (MATCHED, UNMATCHED)}, erddap_url=OBIS_SOURCE_URL,
    )


def test_matched_dataset_takes_ckan_metadata_and_is_not_converted(harvester, mocker):
    mocker.patch.object(obis_harvester, "get_ckan_obis_records", return_value=_ckan(MATCHED))
    convert = mocker.patch.object(obis_harvester, "map_obis_to_cioos", return_value=CONVERTED)
    row = _enrich(harvester).loc[MATCHED]
    assert row["ckan_id"] == f"ckan-{MATCHED}"
    assert row["eovs"] == ["fishAbundanceAndDistribution"]
    assert row["title"] == "CKAN title"
    assert row["title_fr"] == "Titre CKAN"
    assert row["summary"] is None
    convert.assert_called_once_with(_metadata(UNMATCHED))


def test_unmatched_dataset_takes_converted_eovs_and_abstract(harvester, mocker):
    mocker.patch.object(obis_harvester, "get_ckan_obis_records", return_value=_ckan(MATCHED))
    mocker.patch.object(obis_harvester, "map_obis_to_cioos", return_value=CONVERTED)
    row = _enrich(harvester).loc[UNMATCHED]
    assert pd.isna(row["ckan_id"])
    assert row["eovs"] == ["phytoplanktonBiomassAndDiversity"]
    assert row["summary"] == "An abstract"
    assert row["title"] == f"OBIS {UNMATCHED}"
    assert pd.isna(row["title_fr"])


def test_no_ckan_match_converts_every_dataset(harvester, mocker):
    mocker.patch.object(obis_harvester, "get_ckan_obis_records", return_value=_ckan())
    convert = mocker.patch.object(obis_harvester, "map_obis_to_cioos", return_value=CONVERTED)
    df = _enrich(harvester)
    assert convert.call_count == 2
    assert df["ckan_id"].isna().all()
    assert df["summary"].tolist() == ["An abstract", "An abstract"]


def test_conversion_error_leaves_dataset_unenriched(harvester, mocker, tmp_path):
    mocker.patch.object(obis_harvester, "get_ckan_obis_records", return_value=_ckan())
    mocker.patch.object(obis_harvester, "map_obis_to_cioos", side_effect=RuntimeError("parquet down"))
    df = _enrich(harvester)
    assert df["eovs"].tolist() == [[], []]
    assert df["summary"].isna().all()
    assert not any(name.endswith("_cioos.json.gz") for name in os.listdir(tmp_path))


def test_conversion_is_cached(harvester, mocker, tmp_path):
    convert = mocker.patch.object(obis_harvester, "map_obis_to_cioos", return_value=CONVERTED)
    assert harvester.convert_metadata(UNMATCHED) == CONVERTED
    assert harvester.convert_metadata(UNMATCHED) == CONVERTED
    convert.assert_called_once()
    assert os.path.isfile(tmp_path / f"{UNMATCHED}_cioos.json.gz")
