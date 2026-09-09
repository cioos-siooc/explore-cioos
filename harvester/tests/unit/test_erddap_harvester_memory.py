"""
Unit tests for ERDDAPHarvester's chunked-flush memory behavior.

The ERDDAP path used to grow five accumulators with `pd.concat` inside the
per-dataset loop and hold every one of them for the whole server. That is the
same failure that OOM-killed a 6GB container partway through an OBIS run, and
it took down a dev host again on a CIOOS Pacific/Atlantic harvest, where a
single server carries hundreds of large CTD profile datasets.

These mirror tests/unit/test_obis_harvester_memory.py: features are flushed to
disk periodically and correctly reassembled, and the returned result does not
depend on the flush interval.
"""
import os

import pandas as pd
import pytest
from unittest.mock import MagicMock, patch

import cde_harvester.core.frame_spill as frame_spill_module
from cde_harvester.sources.erddap.harvester import ERDDAPHarvester

from conftest import ERDDAP_URL, build_mock_dataset


def _erddap_mock(n_datasets):
    mock = MagicMock()
    mock.domain = "test.erddap.com"
    mock.url = ERDDAP_URL
    df = pd.DataFrame(
        [(f"ds_{i}", "TimeSeries") for i in range(n_datasets)],
        columns=["datasetID", "cdm_data_type"],
    )
    mock.df_all_datasets = df
    mock.get_all_datasets.return_value = df
    mock.get_logger.return_value = __import__("logging").getLogger("test")
    mock.get_croissant_fingerprint.return_value = (None, False, None)
    mock.get_dataset.return_value = build_mock_dataset()
    return mock


def _features_for(dataset):
    """One profile row, tagged with the dataset being harvested so the
    reassembled frame can be checked for completeness and ordering."""
    return pd.DataFrame({
        "dataset_id": [dataset.id],
        "erddap_url": [ERDDAP_URL],
        "timeseries_id": ["STATION_001"],
        "profile_id": [""],
        "latitude": [48.5],
        "longitude": [-125.0],
        "time_min": [pd.Timestamp("2020-01-01", tz="UTC")],
        "time_max": [pd.Timestamp("2023-12-31", tz="UTC")],
        "depth_min": [0.5],
        "depth_max": [200.5],
        "n_records": [1000.0],
        "records_per_day": [0.75],
    })


def _harvest(n_datasets, flush_every):
    harvester = ERDDAPHarvester(ERDDAP_URL)
    harvester.DATASET_FLUSH_EVERY = flush_every
    erddap_mock = _erddap_mock(n_datasets)

    def fake_extract(dataset):
        return _features_for(dataset)

    with (
        patch("cde_harvester.sources.erddap.harvester.ERDDAP", return_value=erddap_mock),
        patch("cde_harvester.sources.erddap.harvester.extract_features", side_effect=fake_extract),
    ):
        # Each dataset must look like a distinct one to the feature builder.
        def get_dataset(dataset_id, *a, **kw):
            ds = build_mock_dataset()
            ds.id = dataset_id
            return ds

        erddap_mock.get_dataset.side_effect = get_dataset
        return harvester.harvest()


def test_features_are_flushed_in_chunks_not_held_for_the_whole_run():
    """With DATASET_FLUSH_EVERY=2 and 5 datasets, profiles must be written to
    disk more than once (mid-run flushes), not only in one end-of-run write."""
    write_sizes = []
    real_to_pickle = pd.DataFrame.to_pickle

    def spy_to_pickle(self, path, *a, **kw):
        if "profiles" in os.path.basename(path):
            write_sizes.append(len(self))
        return real_to_pickle(self, path, *a, **kw)

    with patch.object(pd.DataFrame, "to_pickle", spy_to_pickle):
        result = _harvest(n_datasets=5, flush_every=2)

    # 5 datasets / flush every 2 -> after dataset 2, after dataset 4, plus the
    # final partial flush -> 3 writes, none holding all 5 datasets' features.
    assert len(write_sizes) == 3
    assert max(write_sizes) < 5
    assert result.profiles.shape[0] == 5


def test_final_result_is_identical_regardless_of_chunk_size():
    """Chunking is an internal memory optimization; the returned frames must
    not depend on DATASET_FLUSH_EVERY."""
    unchunked = _harvest(n_datasets=5, flush_every=1000)  # never flushes mid-run
    chunked = _harvest(n_datasets=5, flush_every=2)

    for table in ("profiles", "datasets", "variables"):
        pd.testing.assert_frame_equal(
            getattr(unchunked, table), getattr(chunked, table)
        )


def test_profiles_keep_the_full_schema_columns():
    """The accumulator used to be seeded with an empty schema-shaped frame, and
    that seed decided the output columns — a schema column no dataset filled
    still reached profiles.csv. Dropping it would change the CSV header."""
    result = _harvest(n_datasets=2, flush_every=1)
    from cde_harvester.core.schemas import ProfileSchema

    for column in ProfileSchema.to_schema().columns.keys():
        assert column in result.profiles.columns


def test_chunk_temp_directory_is_cleaned_up_after_harvest():
    """The TemporaryDirectory used for chunk files must not leak on disk."""
    seen_dirs = []
    original_cls = frame_spill_module.tempfile.TemporaryDirectory

    class SpyTempDir(original_cls):
        def __enter__(self):
            path = super().__enter__()
            seen_dirs.append(path)
            return path

    frame_spill_module.tempfile.TemporaryDirectory = SpyTempDir
    try:
        _harvest(n_datasets=3, flush_every=2)
    finally:
        frame_spill_module.tempfile.TemporaryDirectory = original_cls

    assert seen_dirs, "expected the harvest to create a chunk temp dir"
    assert not os.path.isdir(seen_dirs[0])


def test_chunk_temp_directory_is_cleaned_up_even_on_error():
    """A harvest that raises must not leak the chunk temp dir."""
    seen_dirs = []
    original_cls = frame_spill_module.tempfile.TemporaryDirectory

    class SpyTempDir(original_cls):
        def __enter__(self):
            path = super().__enter__()
            seen_dirs.append(path)
            return path

    frame_spill_module.tempfile.TemporaryDirectory = SpyTempDir
    erddap_mock = _erddap_mock(1)
    erddap_mock.get_all_datasets.side_effect = RuntimeError("boom")
    try:
        with patch(
            "cde_harvester.sources.erddap.harvester.ERDDAP", return_value=erddap_mock
        ):
            with pytest.raises(RuntimeError):
                ERDDAPHarvester(ERDDAP_URL).harvest()
    finally:
        frame_spill_module.tempfile.TemporaryDirectory = original_cls

    assert seen_dirs, "expected the harvest to create a chunk temp dir"
    assert not os.path.isdir(seen_dirs[0])
