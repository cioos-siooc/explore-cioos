"""WoRMS functional-group fetching in populate_vernaculars."""
from unittest.mock import MagicMock

import requests
from cde_harvester.loading.populate_vernaculars import (
    STATUS_OK,
    TaxonCache,
    _fetch_taxon_data,
    fetch_functional_groups,
)


def group(value, *stages):
    return {
        "measurementType": "Functional group",
        "measurementValue": value,
        "children": [
            {"measurementType": "Life stage", "measurementValue": s} for s in stages
        ],
    }


def session_returning(body, status=200):
    response = MagicMock(status_code=status, text="x" if body is not None else "")
    response.json.return_value = body
    session = MagicMock()
    session.get.return_value = response
    return session


def test_keeps_adult_and_unstaged_groups_only():
    # Moon jelly: benthic only as a polyp, zooplankton as a larva and adult.
    session = session_returning([
        group("plankton > megaplankton", "adult"),
        group("benthos", "polyp"),
        group("plankton > zooplankton", "larva > planula"),
        group("plankton > zooplankton", "adult"),
        group("plankton > phytoplankton"),
        {"measurementType": "Paraphyletic group", "measurementValue": "Algae"},
    ])
    assert fetch_functional_groups(session, 135306) == [
        "plankton > megaplankton",
        "plankton > phytoplankton",
        "plankton > zooplankton",
    ]
    assert session.get.call_args.kwargs["params"] == {"include_inherited": "true"}


def test_no_attributes_is_an_empty_list():
    assert fetch_functional_groups(session_returning(None, status=204), 1) == []


def test_failed_attribute_fetch_leaves_groups_unset(mocker):
    module = "cde_harvester.loading.populate_vernaculars"
    mocker.patch(f"{module}.fetch_vernaculars", return_value=([], []))
    mocker.patch(f"{module}.fetch_classification", return_value=[2])
    mocker.patch(
        f"{module}.fetch_functional_groups",
        side_effect=requests.ConnectionError("down"),
    )
    result = _fetch_taxon_data(MagicMock(), "Mytilus edulis", 140480, "Species", TaxonCache())
    # None, not []: the row stays selected for the next run.
    assert result.status == STATUS_OK
    assert result.ancestors == [2]
    assert result.functional_groups is None


def test_synonyms_reuse_cached_groups(mocker):
    module = "cde_harvester.loading.populate_vernaculars"
    mocker.patch(f"{module}.fetch_vernaculars", return_value=([], []))
    mocker.patch(f"{module}.fetch_classification", return_value=[2])
    fetch = mocker.patch(f"{module}.fetch_functional_groups", return_value=["benthos"])
    cache = TaxonCache()
    for name in ("Mytilus edulis", "Mytilus edulis edulis"):
        result = _fetch_taxon_data(MagicMock(), name, 140480, "Species", cache)
        assert result.functional_groups == ["benthos"]
    fetch.assert_called_once()
