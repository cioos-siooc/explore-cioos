"""
Unit tests for the distinct-day count OBISHarvester.aggregate_cells() puts on
each obis_cells row.

obis_cells.days feeds the map's `days` ramp (web-api/utils/hexMetric.js) and has
to mean what cde.trajectory_hexes.days means: days that actually have data, not
the elapsed span between the first and last occurrence. The span reading is what
these tests exist to prevent coming back -- it averaged 2171 days per cell and
reached 65454, which is why OBIS outweighed every other source in 87% of the
hexes holding both.
"""
import ast
import datetime

import pandas as pd

from cde_harvester.core.day_sets import ranges_to_csv_cell, total_days
from cde_harvester.loading.loader import prepare_obis_cells_dataframe
from cde_harvester.sources.obis.harvester import OBISHarvester

DAY = 86_400_000  # OBIS dates are epoch milliseconds


def occurrence(day_index=None, lat=44.6, lon=-63.6, end_day_index=None):
    """One occurrence on `day_index` days after the epoch.

    `day_index=None` is an undated record. `end_day_index` widens date_end to
    model OBIS's coarse-eventDate bounds (a year-precision record arrives as
    Jan 1 -> Dec 31).
    """
    start = None if day_index is None else day_index * DAY
    end = start if end_day_index is None else end_day_index * DAY
    return {
        "decimalLatitude": lat,
        "decimalLongitude": lon,
        "scientificName": "Gadus morhua",
        "date_start": start,
        "date_end": end,
        "minimumDepthInMeters": 0,
        "maximumDepthInMeters": 0,
    }


def cells_for(results):
    harvester = OBISHarvester(folder="./obis")
    return harvester.aggregate_cells("ds-1", results)


class TestDayCount:
    def test_same_day_counts_once(self):
        """Three occurrences on one day is one day of data, not three."""
        cells = cells_for([occurrence(10), occurrence(10), occurrence(10)])
        assert len(cells) == 1
        assert cells["days"].iloc[0] == 1
        assert cells["n_records"].iloc[0] == 3

    def test_distinct_days_count_separately(self):
        cells = cells_for([occurrence(10), occurrence(11), occurrence(12)])
        assert cells["days"].iloc[0] == 3

    def test_gap_between_days_is_not_counted(self):
        """The whole point: two visits a decade apart are two days, not ~3650.

        This is the span defect (database/5_profile_process.sql still has it for
        profiles) -- if `days` ever tracks time_max - time_min again, this fails.
        """
        cells = cells_for([occurrence(0), occurrence(3650)])
        assert cells["days"].iloc[0] == 2
        span_days = (
            cells["time_max"].iloc[0] - cells["time_min"].iloc[0]
        ).days + 1
        assert span_days == 3651
        assert cells["days"].iloc[0] < span_days

    def test_coarse_date_counts_one_day_not_its_range(self):
        """A year-precision record spans Jan 1 -> Dec 31 but is one sampling event.

        Expanding date_start..date_end would rebuild the span defect, so the day
        comes from date_start alone.
        """
        cells = cells_for([occurrence(0, end_day_index=364)])
        assert cells["days"].iloc[0] == 1

    def test_undated_occurrences_contribute_no_days(self):
        """nunique skips NaT. Matches the old behaviour: the span expression
        yielded NULL for these and sum() skipped it."""
        cells = cells_for([occurrence(None), occurrence(None)])
        assert cells["days"].iloc[0] == 0
        assert cells["n_records"].iloc[0] == 2

    def test_undated_mixed_with_dated_counts_only_the_dated(self):
        cells = cells_for([occurrence(5), occurrence(None), occurrence(6)])
        assert cells["days"].iloc[0] == 2
        assert cells["n_records"].iloc[0] == 3

    def test_days_never_exceeds_the_span(self):
        """The invariant the post-harvest SQL check asserts against the live DB."""
        cells = cells_for([occurrence(i) for i in (0, 1, 5, 5, 40)])
        span_days = (
            cells["time_max"].iloc[0] - cells["time_min"].iloc[0]
        ).days + 1
        assert cells["days"].iloc[0] == 4
        assert cells["days"].iloc[0] <= span_days

    def test_missing_date_columns_do_not_raise(self):
        """Not every OBIS dataset carries dates; the column is filled with None
        before the day is derived, so this must degrade to 0 rather than throw."""
        results = [
            {
                "decimalLatitude": 44.6,
                "decimalLongitude": -63.6,
                "scientificName": "Gadus morhua",
            }
        ]
        cells = cells_for(results)
        assert cells["days"].iloc[0] == 0


class TestDayCountPerCell:
    def test_days_are_counted_per_cell_not_per_dataset(self):
        """Two cells sampled on the same day are two rows of one day each --
        the map sums them, which is the "two stations on a day is two days"
        semantic the ramp is meant to carry."""
        cells = cells_for(
            [occurrence(10, lat=44.6, lon=-63.6), occurrence(10, lat=48.0, lon=-60.0)]
        )
        assert len(cells) == 2
        assert set(cells["days"]) == {1}
        assert cells["days"].sum() == 2

    def test_one_cell_busy_the_other_not(self):
        cells = cells_for(
            [occurrence(d, lat=44.6, lon=-63.6) for d in (1, 2, 3)]
            + [occurrence(1, lat=48.0, lon=-60.0)]
        )
        by_lat = cells.set_index(cells["latitude"].round(2))["days"]
        assert by_lat.loc[44.58] == 3
        assert by_lat.loc[48.0] == 1


class TestLoaderRoundTrip:
    def test_dedup_keeps_days_and_casts_to_int64(self):
        """prepare_obis_cells_dataframe's groupby is a whitelist -- a column with
        no aggregation rule is silently dropped. This is that guard."""
        from cde_harvester.loading.loader import prepare_obis_cells_dataframe

        df = pd.DataFrame(
            [
                {
                    "dataset_id": "ds-1",
                    "latitude": 44.6,
                    "longitude": -63.6,
                    "scientific_names": ["Gadus morhua"],
                    "n_records": 3,
                    "days": 2,
                    "time_min": pd.Timestamp("2020-01-01", tz="UTC"),
                    "time_max": pd.Timestamp("2020-01-03", tz="UTC"),
                    "depth_min": 0.0,
                    "depth_max": 0.0,
                }
            ]
        )
        out = prepare_obis_cells_dataframe(df)
        assert "days" in out.columns
        assert out["days"].dtype == "Int64"
        assert out["days"].iloc[0] == 2

    def test_dedup_takes_max_days_not_sum(self):
        """Float-noise duplicates are the SAME cell, so their day sets overlap.
        Summing would inflate -- the defect obis_cells.days exists to remove."""
        from cde_harvester.loading.loader import prepare_obis_cells_dataframe

        rows = [
            {
                "dataset_id": "ds-1",
                "latitude": 44.6,
                "longitude": -63.6,
                "scientific_names": ["Gadus morhua"],
                "n_records": 3,
                "days": days,
                "time_min": pd.Timestamp("2020-01-01", tz="UTC"),
                "time_max": pd.Timestamp("2020-01-03", tz="UTC"),
                "depth_min": 0.0,
                "depth_max": 0.0,
            }
            for days in (2, 3)
        ]
        out = prepare_obis_cells_dataframe(pd.DataFrame(rows))
        assert len(out) == 1
        assert out["days"].iloc[0] == 3
        assert out["n_records"].iloc[0] == 6


class TestCsvRoundTrip:
    """obis_cells day_ranges through the CSV, the way a real run loads them.

    The harvest writes CSVs and the loader reads them back in a separate task,
    so this is the only path a deployed run ever takes. It went untested: the
    TestLoaderRoundTrip cases above hand prepare_obis_cells_dataframe a frame
    with no day_ranges column at all, and the CSV serialization was omitted for
    obis_cells while profiles had it -- so every OBIS load failed in
    merge_ranges with "not enough values to unpack (expected 2, got 1)".
    """

    def _to_csv_and_back(self, cells, tmp_path):
        """Mirror __main__.write_dataframes -> loader read for obis_cells."""
        cells = cells.copy()
        cells["day_ranges"] = cells["day_ranges"].apply(ranges_to_csv_cell)
        path = tmp_path / "obis_cells.csv"
        cells.to_csv(path, index=False)
        return pd.read_csv(path)

    def test_day_ranges_survive_the_csv(self, tmp_path):
        cells = cells_for([occurrence(10), occurrence(11), occurrence(3650)])
        loaded = self._to_csv_and_back(cells, tmp_path)

        out = prepare_obis_cells_dataframe(loaded)

        # two runs: the consecutive pair, then the visit a decade later
        assert out["day_ranges"].iloc[0] == [
            (datetime.date(1970, 1, 11), datetime.date(1970, 1, 13)),
            (datetime.date(1979, 12, 30), datetime.date(1979, 12, 31)),
        ]

    def test_written_cell_is_literal_evaluable(self, tmp_path):
        """The defect itself: repr(datetime.date(...)) cannot be read back."""
        cells = cells_for([occurrence(10)])
        loaded = self._to_csv_and_back(cells, tmp_path)
        assert ast.literal_eval(loaded["day_ranges"].iloc[0]) == [["1970-01-11", "1970-01-12"]]

    def test_float_split_cells_union_their_day_sets(self, tmp_path):
        """Rows the dedup merges are the same cell, so the sets union."""
        cells = pd.concat(
            [
                cells_for([occurrence(10, lat=44.6)]),
                cells_for([occurrence(20, lat=44.600000000000001)]),
            ],
            ignore_index=True,
        )
        loaded = self._to_csv_and_back(cells, tmp_path)

        out = prepare_obis_cells_dataframe(loaded)

        assert len(out) == 1
        assert out["day_ranges"].iloc[0] == [
            (datetime.date(1970, 1, 11), datetime.date(1970, 1, 12)),
            (datetime.date(1970, 1, 21), datetime.date(1970, 1, 22)),
        ]

    def test_missing_day_ranges_column_still_loads(self, tmp_path):
        """A CSV predating day sets must not become unloadable."""
        cells = cells_for([occurrence(10)]).drop(columns=["day_ranges"])
        path = tmp_path / "obis_cells.csv"
        cells.to_csv(path, index=False)

        out = prepare_obis_cells_dataframe(pd.read_csv(path))

        assert "day_ranges" not in out.columns
        assert out["days"].iloc[0] == 1

    def test_days_reports_the_union_not_the_larger_half(self, tmp_path):
        """days and day_ranges must agree about the same cell.

        max() is right only while the merged rows overlap. Two float-noise
        halves sampled on different days union to two days; max() says one.
        """
        cells = pd.concat(
            [
                cells_for([occurrence(10, lat=44.6)]),
                cells_for([occurrence(20, lat=44.600000000000001)]),
            ],
            ignore_index=True,
        )
        loaded = self._to_csv_and_back(cells, tmp_path)

        out = prepare_obis_cells_dataframe(loaded)

        assert out["days"].iloc[0] == 2
        assert out["days"].iloc[0] == total_days(out["day_ranges"].iloc[0])
