"""The listing extent as a change signal: hashing it, and the skip it drives.

Covers what the Croissant hash cannot: database-backed (realtime) datasets,
which list no files and so were re-harvested in full every run.
"""

import logging
from collections import namedtuple
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pandas as pd

from conftest import DATASET_ID, ERDDAP_URL, build_mock_dataset
from cde_harvester.core.errors import UNCHANGED_EXTENT
from cde_harvester.sources.erddap.client import listing_extent_signature
from cde_harvester.sources.erddap.harvester import MAX_SKIP_AGE_DAYS, harvest_dataset

ListingRow = namedtuple(
    "ListingRow",
    "datasetID minTime maxTime minLatitude maxLatitude "
    "minLongitude maxLongitude minAltitude maxAltitude",
)


def _row(max_time="2026-08-20T20:30:10Z"):
    return ListingRow(DATASET_ID, "2020-01-01T00:00:00Z", max_time,
                      44.0, 45.0, -64.0, -63.0, None, None)


def _erddap_mock():
    mock = MagicMock()
    mock.url = ERDDAP_URL
    mock.domain = "test.erddap.com"
    mock.get_logger.return_value = logging.getLogger("test")
    # Database-backed dataset: no file list, so no content_hash — exactly the
    # case the extent signal exists to cover.
    mock.get_croissant_fingerprint.return_value = (None, False, "HASH_NO_FILE_LIST")
    mock.get_dataset.return_value = build_mock_dataset()
    return mock


def _harvest(erddap, row, previous_state):
    extent_hash, source_time_max = listing_extent_signature(row)
    with patch(
        "cde_harvester.sources.erddap.harvester.extract_features",
        return_value=pd.DataFrame(),
    ):
        return harvest_dataset(
            erddap, DATASET_ID,
            previous_state=previous_state, skip_unchanged=True,
            extent_hash=extent_hash, source_time_max=source_time_max,
        )


def _state(row, age_days=1):
    return {DATASET_ID: {
        "content_hash": None,
        "source_extent_hash": listing_extent_signature(row)[0],
        "last_updated_at": datetime.now(timezone.utc) - timedelta(days=age_days),
    }}


class TestListingExtentSignature:
    def test_is_stable_and_sensitive_to_max_time(self):
        assert listing_extent_signature(_row())[0] == listing_extent_signature(_row())[0]
        assert (listing_extent_signature(_row())[0]
                != listing_extent_signature(_row("2026-08-20T21:30:10Z"))[0])

    def test_returns_parsed_utc_max_time(self):
        _, max_time = listing_extent_signature(_row())
        assert max_time == datetime(2026, 8, 20, 20, 30, 10, tzinfo=timezone.utc)

    def test_row_without_extent_columns_yields_nothing(self):
        NoExtent = namedtuple("NoExtent", "datasetID")
        assert listing_extent_signature(NoExtent(DATASET_ID)) == (None, None)


class TestExtentSkip:
    def test_unchanged_extent_skips_without_any_request(self):
        erddap = _erddap_mock()
        result = _harvest(erddap, _row(), _state(_row()))

        assert result.status == "skipped_unchanged"
        assert result.attempt["reason_code"] == UNCHANGED_EXTENT
        # The point of the check: it runs before the Croissant request.
        erddap.get_croissant_fingerprint.assert_not_called()
        erddap.get_dataset.assert_not_called()

    def test_skip_records_verified_at_so_pruning_keeps_the_dataset(self):
        # prune_stale_datasets() deletes anything absent from both temp_datasets
        # and temp_verified, so a skip must still date-stamp the dataset.
        result = _harvest(_erddap_mock(), _row(), _state(_row()))
        assert result.verified_at is not None

    def test_changed_extent_harvests(self):
        erddap = _erddap_mock()
        result = _harvest(erddap, _row("2026-08-20T22:00:00Z"), _state(_row()))

        assert result.status != "skipped_unchanged"
        erddap.get_dataset.assert_called_once()

    def test_stale_dataset_is_reharvested_despite_unchanged_extent(self):
        # An in-place edit (values corrected at existing times) never moves the
        # extent, so the skip is bounded by age.
        erddap = _erddap_mock()
        result = _harvest(erddap, _row(), _state(_row(), age_days=MAX_SKIP_AGE_DAYS + 1))

        assert result.status != "skipped_unchanged"
        erddap.get_dataset.assert_called_once()

    def test_unknown_dataset_is_harvested(self):
        erddap = _erddap_mock()
        result = _harvest(erddap, _row(), {})

        assert result.status != "skipped_unchanged"
        erddap.get_dataset.assert_called_once()

    def test_harvested_dataset_carries_the_freshness_signals(self):
        erddap = _erddap_mock()
        dataset = erddap.get_dataset.return_value
        _harvest(erddap, _row(), {})

        assert dataset.source_extent_hash == listing_extent_signature(_row())[0]
        assert dataset.source_time_max == datetime(2026, 8, 20, 20, 30, 10,
                                                   tzinfo=timezone.utc)
