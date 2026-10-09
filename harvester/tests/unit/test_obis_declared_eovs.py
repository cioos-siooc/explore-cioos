"""OBIS datasets keep CKAN's EOVs in declared_eovs.

obis_derive_eovs() rebuilds `eovs` as declared_eovs plus the EOVs derived from
the dataset's taxa, so declared_eovs must hold exactly what CKAN said.
"""
import pandas as pd
import pytest
from cde_harvester.sources.obis import harvester as obis_harvester
from cde_harvester.sources.obis.harvester import OBISHarvester


@pytest.fixture
def harvester(tmp_path):
    return OBISHarvester(limit_dataset_ids=["ds-1", "ds-2"], folder=str(tmp_path))


def datasets(h):
    return pd.concat(
        [h.build_dataset_row(d, {"title": d}, pd.DataFrame()) for d in ("ds-1", "ds-2")],
        ignore_index=True,
    )


def test_ckan_eovs_become_declared(harvester, monkeypatch):
    monkeypatch.setattr(
        obis_harvester,
        "get_ckan_obis_records",
        lambda *a, **k: pd.DataFrame([{
            "dataset_id": "ds-1", "ckan_id": "c1", "ckan_eovs": ["zooplanktonBiomassAndDiversity"],
            "ckan_title": None, "title_fr": None,
        }]),
    )
    df = harvester._enrich_with_ckan(datasets(harvester)).set_index("dataset_id")
    assert df.loc["ds-1", "declared_eovs"] == ["zooplanktonBiomassAndDiversity"]
    assert df.loc["ds-1", "eovs"] == ["zooplanktonBiomassAndDiversity"]
    assert df.loc["ds-2", "declared_eovs"] == []


def test_declared_eovs_empty_without_ckan(harvester, monkeypatch):
    monkeypatch.setattr(obis_harvester, "get_ckan_obis_records", lambda *a, **k: pd.DataFrame())
    df = harvester._enrich_with_ckan(datasets(harvester))
    assert df["declared_eovs"].tolist() == [[], []]
