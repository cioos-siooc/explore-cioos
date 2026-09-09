"""Unit tests for cde_harvester.core.harvest_files.

These pin the three properties the harvester/loader handoff depends on and
that the previous CSV contract could not provide: list columns arrive as
lists, timestamps arrive as UTC, and a frame carrying either can still be
de-duplicated.
"""

import datetime
import os

import numpy as np
import pandas as pd
import pytest
from psycopg2 import ProgrammingError
from psycopg2.extensions import adapt

from cde_harvester.core.harvest_files import (
    DATASETS,
    PROFILES,
    drop_duplicate_rows,
    read_table,
    table_path,
    write_table,
)


class TestListColumns:
    """duckdb returns LIST columns as numpy arrays; psycopg2 cannot adapt one."""

    def test_list_of_strings_comes_back_as_a_list(self, tmp_path):
        write_table(str(tmp_path), DATASETS, pd.DataFrame({"eovs": [["a", "b"]]}))
        value = read_table(str(tmp_path), DATASETS)["eovs"].iloc[0]
        assert value == ["a", "b"]
        assert isinstance(value, list)

    def test_nested_lists_are_converted_all_the_way_down(self, tmp_path):
        """day_ranges is a list of pairs, so a shallow conversion is not enough."""
        write_table(
            str(tmp_path), PROFILES,
            pd.DataFrame({"day_ranges": [[["2020-01-01", "2020-02-01"]]]}),
        )
        value = read_table(str(tmp_path), PROFILES)["day_ranges"].iloc[0]
        assert value == [["2020-01-01", "2020-02-01"]]
        assert isinstance(value[0], list)

    def test_list_columns_are_adaptable_by_psycopg2(self, tmp_path):
        """The reason the conversion exists: an ndarray reaches the loader as
        `can't adapt type 'numpy.ndarray'`, mid-load."""
        write_table(str(tmp_path), DATASETS, pd.DataFrame({"eovs": [["a", "b"]]}))
        value = read_table(str(tmp_path), DATASETS)["eovs"].iloc[0]
        assert adapt(value).getquoted() == b"ARRAY['a','b']"
        with pytest.raises(ProgrammingError, match="can't adapt type 'numpy.ndarray'"):
            adapt(np.array(["a", "b"], dtype=object)).getquoted()

    def test_integer_lists_come_back_as_python_ints(self, tmp_path):
        """organization_pks and aphia_ids are ARRAY(INTEGER) columns. duckdb
        returns their elements as numpy.int32, which psycopg2 adapts no better
        than it adapts the array — so unwrapping the array alone is not enough."""
        write_table(
            str(tmp_path), DATASETS, pd.DataFrame({"organization_pks": [[7, 8]]})
        )
        value = read_table(str(tmp_path), DATASETS)["organization_pks"].iloc[0]
        assert value == [7, 8]
        assert all(type(v) is int for v in value)
        assert adapt(value).getquoted() == b"ARRAY[7,8]"

    def test_empty_and_absent_lists_are_distinguishable(self, tmp_path):
        write_table(
            str(tmp_path), DATASETS, pd.DataFrame({"eovs": [["a"], [], None]})
        )
        values = list(read_table(str(tmp_path), DATASETS)["eovs"])
        assert values[0] == ["a"]
        assert values[1] == []
        assert values[2] is None

    def test_list_of_dicts_survives_for_the_jsonb_columns(self, tmp_path):
        """grid_variables/grid_dimensions land in jsonb columns."""
        grid = [{"name": "sst", "units": "degree_C"}]
        write_table(str(tmp_path), DATASETS, pd.DataFrame({"grid_variables": [grid]}))
        assert read_table(str(tmp_path), DATASETS)["grid_variables"].iloc[0] == grid


class TestTimestamps:
    def test_tz_aware_timestamps_come_back_as_utc(self, tmp_path):
        """DuckDB renders a timestamptz in the SESSION timezone, which defaults
        to the host's. Everything here is UTC, and a day boundary read in local
        time shifts dates silently — so the connection pins UTC rather than
        inheriting whatever the machine is set to."""
        written = pd.to_datetime(["2026-01-01T00:00:00Z"], utc=True)
        write_table(str(tmp_path), DATASETS, pd.DataFrame({"verified_at": written}))
        column = read_table(str(tmp_path), DATASETS)["verified_at"]
        assert str(column.dtype) == "datetime64[ns, UTC]"
        assert column.iloc[0] == written[0]
        # The date a UTC-midnight instant falls on must not drift westward.
        assert column.iloc[0].date() == datetime.date(2026, 1, 1)

    def test_missing_timestamps_stay_null(self, tmp_path):
        write_table(
            str(tmp_path), DATASETS,
            pd.DataFrame({"verified_at": pd.to_datetime([None, "2026-01-01"], utc=True)}),
        )
        assert pd.isna(read_table(str(tmp_path), DATASETS)["verified_at"].iloc[0])


class TestMissingTables:
    def test_absent_table_reads_as_none(self, tmp_path):
        assert read_table(str(tmp_path), "obis_cells") is None

    def test_a_legacy_csv_folder_says_so(self, tmp_path):
        """Pointing the loader at a pre-parquet harvest folder must name the
        problem, not read as 'this harvest produced no datasets' — which is how
        a full reload decides whether to refuse to wipe the database."""
        (tmp_path / "datasets.csv").write_text("dataset_id\nabc\n")
        with pytest.raises(FileNotFoundError, match="Re-harvest"):
            read_table(str(tmp_path), DATASETS)


class TestDropDuplicateRows:
    def test_drops_rows_identical_including_their_lists(self):
        df = pd.DataFrame({"id": ["a", "a", "b"], "eovs": [["t"], ["t"], ["s"]]})
        assert len(drop_duplicate_rows(df)) == 2

    def test_keeps_rows_differing_only_in_a_list_column(self):
        df = pd.DataFrame({"id": ["a", "a"], "eovs": [["t"], ["s"]]})
        assert len(drop_duplicate_rows(df)) == 2

    def test_handles_nested_lists(self):
        """tuple() alone leaves the inner lists unhashable."""
        runs = [["2020-01-01", "2020-02-01"]]
        df = pd.DataFrame({"id": ["a", "a"], "day_ranges": [runs, runs]})
        assert len(drop_duplicate_rows(df)) == 1

    def test_matches_what_the_previous_repr_based_dedup_did(self):
        df = pd.DataFrame({"id": ["a", "a", "b"], "eovs": [["t"], ["t"], ["s"]]})
        by_repr = df[~df.assign(eovs=df["eovs"].map(repr)).duplicated()]
        pd.testing.assert_frame_equal(drop_duplicate_rows(df), by_repr)


class TestPaths:
    def test_write_creates_the_folder(self, tmp_path):
        folder = str(tmp_path / "nested" / "harvest")
        path = write_table(folder, DATASETS, pd.DataFrame({"a": [1]}))
        assert os.path.isfile(path)
        assert path == table_path(folder, DATASETS)
