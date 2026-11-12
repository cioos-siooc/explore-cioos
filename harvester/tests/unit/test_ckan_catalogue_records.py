"""The CKAN records no harvested dataset cites, loaded as the `ckan` source."""

import pandas as pd
import pytest
from cde_harvester.core.schemas import DatasetSchema
from cde_harvester.prefect_pipeline import _configured_sources, deployment_slug
from cde_harvester.sources import resolve_source
from cde_harvester.sources.ckan.catalogue_records import (
    CATALOGUE_VERSION,
    CKAN_SOURCE_URL,
    catalogue_result,
)


def record(record_id, **fields):
    return {
        "id": record_id,
        "title": f"Record {record_id}",
        "title_translated": {"en": f"Record {record_id}", "fr": f"Fiche {record_id}"},
        "resource-type": "dataset",
        "metadata_modified": "2026-10-01T12:00:00.000000",
        "spatial": '{"type": "Polygon", "coordinates": [[[-130.5, 48], [-125, 48], '
                   '[-125, 51.25], [-130.5, 51.25], [-130.5, 48]]]}',
        "temporal-extent": [{"begin": "2021-03-26", "end": "2022-06-06"}],
        "vertical-extent": [{"min": "22.43", "max": "395.42"}],
        "eov": ["subSurfaceTemperature", "oxygen"],
        "cited-responsible-party": [{"organisation-name": "Ocean Networks Canada"}],
        "resources": [{"url": "https://example.org/data.csv", "format": "CSV"}],
        **fields,
    }


def harvest(records, cited=(), stored=None, skip_unchanged=True):
    return catalogue_result(records, set(cited), stored or {}, "run-1", skip_unchanged)


def test_an_uncited_record_becomes_a_footprint_only_dataset():
    result = harvest([record("a")])

    row = result.datasets.iloc[0]
    assert row["erddap_url"] == CKAN_SOURCE_URL
    assert row["dataset_id"] == row["ckan_id"] == "a"
    assert row["source_type"] == "ckan"
    assert (row["title"], row["title_fr"]) == ("Record a", "Fiche a")
    assert (row["coverage_lon_min"], row["coverage_lon_max"]) == (-130.5, -125)
    assert (row["coverage_lat_min"], row["coverage_lat_max"]) == (48, 51.25)
    assert row["coverage_time_min"] == pd.Timestamp("2021-03-26", tz="UTC")
    assert row["coverage_time_max"] == pd.Timestamp("2022-06-06", tz="UTC")
    assert (row["coverage_depth_min"], row["coverage_depth_max"]) == (22.43, 395.42)
    assert row["eovs"] == ["oxygen", "subSurfaceTemperature"]
    assert row["organizations"] == ["Ocean Networks Canada"]
    assert row["n_profiles"] == 0
    assert row["metadata"]["resources"][0]["url"] == "https://example.org/data.csv"
    assert row["content_hash"] == f"{CATALOGUE_VERSION}:2026-10-01T12:00:00.000000"
    assert result.attempts["status"].tolist() == ["success"]
    DatasetSchema.validate(result.datasets)


def test_cited_records_and_non_datasets_are_not_part_of_the_source():
    result = harvest([record("cited"), record("doc", **{"resource-type": "document"})],
                     cited={"cited"})

    assert result.datasets.empty
    assert result.attempts.empty
    assert result.skipped.empty


def test_the_footprint_comes_from_the_spatial_geometry():
    # The bbox-* fields of this real record have south and north swapped.
    spatial = {"type": "Polygon", "coordinates": [[[-66.45, 50.12], [-66.76, 50.01],
                                                   [-66.56, 50.15], [-66.45, 50.12]]]}
    result = harvest([record("a", spatial=spatial, **{"bbox-south-lat": "50.15",
                                                     "bbox-north-lat": "50.01"})])

    row = result.datasets.iloc[0]
    assert (row["coverage_lon_min"], row["coverage_lon_max"]) == (-66.76, -66.45)
    assert (row["coverage_lat_min"], row["coverage_lat_max"]) == (50.01, 50.15)


def test_a_point_and_0_to_360_longitudes_are_footprints_too():
    point = harvest([record("a", spatial={"type": "Point", "coordinates": [-126.17, 48.43]})])
    wrapped = harvest([record("b", spatial={"type": "LineString",
                                            "coordinates": [[187.6, 45.4], [204.3, 51.9]]})])

    assert point.datasets.iloc[0][["coverage_lon_min", "coverage_lat_max"]].tolist() == [
        -126.17, 48.43,
    ]
    lon_min, lon_max = wrapped.datasets.iloc[0][["coverage_lon_min", "coverage_lon_max"]]
    assert (round(lon_min, 1), round(lon_max, 1)) == (-172.4, -155.7)


@pytest.mark.parametrize("spatial", [
    None,
    "not json",
    {"type": "Polygon", "coordinates": []},
    {"type": "Point", "coordinates": [-126, 95]},
])
def test_a_record_without_a_valid_footprint_is_skipped(spatial):
    result = harvest([record("a", spatial=spatial)])

    assert result.datasets.empty
    assert result.skipped.values.tolist() == [[CKAN_SOURCE_URL, "a", "NO_SPATIAL_EXTENT"]]
    assert result.attempts["reason_code"].tolist() == ["NO_SPATIAL_EXTENT"]


def test_an_unchanged_record_is_only_verified():
    stored = {"a": f"{CATALOGUE_VERSION}:2026-10-01T12:00:00.000000"}

    result = harvest([record("a")], stored=stored)

    assert result.datasets.empty
    assert result.verified["dataset_id"].tolist() == ["a"]
    assert result.attempts["reason_code"].tolist() == ["UNCHANGED"]


def test_an_unchanged_record_reloads_without_skip_unchanged():
    stored = {"a": f"{CATALOGUE_VERSION}:2026-10-01T12:00:00.000000"}

    result = harvest([record("a")], stored=stored, skip_unchanged=False)

    assert result.datasets["dataset_id"].tolist() == ["a"]
    assert result.verified.empty


def test_missing_extents_stay_empty():
    result = harvest([record("a", **{"temporal-extent": [], "vertical-extent": None})])

    row = result.datasets.iloc[0]
    assert pd.isna(row["coverage_time_min"]) and pd.isna(row["coverage_time_max"])
    assert row["coverage_depth_min"] is None and row["coverage_depth_max"] is None


def test_a_date_beyond_the_schema_range_is_dropped():
    result = harvest([record("a", **{"temporal-extent": [{"begin": "1534-07-04", "end": None}]})])

    row = result.datasets.iloc[0]
    assert pd.isna(row["coverage_time_min"]) and pd.isna(row["coverage_time_max"])
    DatasetSchema.validate(result.datasets)


@pytest.mark.parametrize("source", ["ckan", "https://catalogue.cioos.ca", "catalogue.cioos.ca"])
def test_the_source_resolves_from_any_spelling(source):
    assert resolve_source(source, ["https://data.cioospacific.ca/erddap"]) == "ckan"
    assert deployment_slug(source) == "ckan"


def test_the_source_is_scheduled_only_when_configured():
    assert _configured_sources("https://a.example/erddap", [], None) == ["https://a.example/erddap"]
    assert _configured_sources("https://a.example/erddap", [], None, ckan_catalogue=True) == [
        "https://a.example/erddap", "ckan",
    ]
