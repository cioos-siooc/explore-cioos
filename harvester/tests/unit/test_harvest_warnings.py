import json
import logging

from cde_harvester.core.harvest_warnings import MAX_ITEMS, HarvestWarnings

LOG = logging.getLogger("test.harvest_warnings")


def test_empty_serializes_to_none():
    assert HarvestWarnings(LOG).to_json() is None


def test_entry_shape():
    warnings = HarvestWarnings(LOG)
    warnings.add("FEATURES_DROPPED", "2 features removed", items=["a", "b"], count=2)
    assert json.loads(warnings.to_json()) == [{
        "code": "FEATURES_DROPPED", "message": "2 features removed",
        "items": ["a", "b"], "count": 2,
    }]


def test_repeated_code_merges_into_one_entry():
    warnings = HarvestWarnings(LOG)
    warnings.add("FEATURES_DROPPED", "1 removed: time", items=["a"], count=1)
    warnings.add("FEATURES_DROPPED", "2 removed: position", items=["a", "b"], count=2)
    [entry] = warnings
    assert entry["count"] == 3
    assert entry["items"] == ["a", "b"]
    assert entry["message"] == "1 removed: time; 2 removed: position"


def test_items_are_capped():
    warnings = HarvestWarnings(LOG)
    warnings.add("NON_CF_STANDARD_NAMES", "many", items=[f"n{i}" for i in range(50)])
    [entry] = warnings
    assert len(entry["items"]) == MAX_ITEMS


def test_add_logs_the_message(caplog):
    with caplog.at_level(logging.WARNING):
        HarvestWarnings(LOG).add("TRACKS_UNAVAILABLE", "tracks skipped")
    assert "tracks skipped" in caplog.text
