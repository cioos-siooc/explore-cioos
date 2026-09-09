"""Unit tests for per-feature day sets (cde.profiles.days / day_ranges).

The map's `days` metric counts the distinct UTC days a hex holds data for. It
gets there by unioning per-feature day SETS rather than summing per-feature day
counts, so these tests guard two separate things:

  * that a feature's day set holds the days it actually has data on, not the
    elapsed span between its first and last observation (the defect this
    replaces: glisa_general_seasonal_erie reported 39,357 days for ~430 days of
    real data);
  * that the set survives the CSV and to_sql round trips intact, because a
    silently-dropped or mis-typed column would put every row back on the span
    fallback without failing anything.

test_obis_cell_days.py is the sibling of this file for the OBIS source, and
database/8_range_functions.sql holds the SQL twin of the merge logic.
"""

import datetime
import logging

import pandas as pd
import pytest
from requests.exceptions import HTTPError

from cde_harvester.core.day_sets import (
    bucket_index_to_day,
    day_bucket_group,
    days_to_ranges,
    merge_ranges,
    ranges_from_iso,
    ranges_to_iso,
    ranges_to_pg_literal,
    ranges_to_psycopg,
    total_days,
)
from cde_harvester.dataset_types.profile import ProfileHandler
from cde_harvester.dataset_types.tabledap_features import (
    MAX_DAY_COUNT_ROWS,
    _extract_day_sets,
)
from cde_harvester.dataset_types.timeseries import TimeSeriesHandler
from cde_harvester.dataset_types.timeseries_profile import TimeSeriesProfileHandler
from cde_harvester.sources.erddap.client import ERDDAP, ResponseTooLargeError


LOG = logging.getLogger("test.profile_days")


def d(iso):
    return datetime.date.fromisoformat(iso)


def profiles_frame(rows, index_name="station_id"):
    """A feature frame shaped the way _extract_day_sets sees it: indexed by the
    cf_role variables, with time bounds still as raw ERDDAP strings."""
    frame = pd.DataFrame(rows).set_index(index_name)
    return frame


@pytest.fixture
def one_station():
    return profiles_frame(
        [{"station_id": "S1", "time_min": "2020-01-01T00:00:00Z",
          "time_max": "2020-12-31T00:00:00Z"}]
    )


class FakeDataset:
    """Just enough dataset for _extract_day_sets: one query method and a logger."""

    def __init__(self, response=None, raises=None):
        self.response = response if response is not None else pd.DataFrame()
        self.raises = raises
        self.queries = []

    def dataset_tabledap_query(self, url):
        self.queries.append(url)
        if self.raises:
            raise self.raises
        return self.response


def day_count_response(pairs, index_name="station_id"):
    """An orderByCount response as ERDDAP actually returns it.

    The grouped `time/86400` column comes back as the BUCKET INDEX rendered as
    if it were epoch seconds — day 18262 arrives as 1970-01-01T05:04:22Z, not
    2020-01-01. Building the fixture that way is the point: a test that fed real
    timestamps would pass against code that skips the decode.
    """
    rows = []
    for station, day in pairs:
        index = (d(day) - d("1970-01-01")).days
        rows.append(
            {
                index_name: station,
                "time": pd.Timestamp(index, unit="s", tz="UTC").strftime(
                    "%Y-%m-%dT%H:%M:%SZ"
                ),
                "latitude": 1,
            }
        )
    return pd.DataFrame(rows)


class TestDaySetsFromErddap:
    def test_distinct_days_count_separately(self, one_station):
        ds = FakeDataset(day_count_response(
            [("S1", "2020-03-01"), ("S1", "2020-06-15"), ("S1", "2020-09-30")]
        ))
        out = _extract_day_sets(ds, one_station, ["station_id"], LOG)
        assert out.loc["S1", "days"] == 3

    def test_same_day_counts_once(self, one_station):
        ds = FakeDataset(day_count_response(
            [("S1", "2020-03-01"), ("S1", "2020-03-01")]
        ))
        out = _extract_day_sets(ds, one_station, ["station_id"], LOG)
        assert out.loc["S1", "days"] == 1

    def test_gap_between_days_is_not_counted(self, one_station):
        """The span defect, stated as a test.

        Two observations a year apart are two days of data, not the 366 the
        elapsed span would claim. If `days` ever tracks time_max - time_min
        again, this fails.
        """
        ds = FakeDataset(day_count_response(
            [("S1", "2020-01-01"), ("S1", "2020-12-31")]
        ))
        out = _extract_day_sets(ds, one_station, ["station_id"], LOG)
        assert out.loc["S1", "days"] == 2
        span_days = (d("2020-12-31") - d("2020-01-01")).days + 1
        assert span_days == 366
        assert out.loc["S1", "days"] < span_days

    def test_consecutive_days_collapse_to_one_range(self, one_station):
        ds = FakeDataset(day_count_response(
            [("S1", "2020-03-01"), ("S1", "2020-03-02"), ("S1", "2020-03-03")]
        ))
        out = _extract_day_sets(ds, one_station, ["station_id"], LOG)
        assert out.loc["S1", "days"] == 3
        assert len(out.loc["S1", "day_ranges"]) == 1

    def test_seasonal_station_keeps_one_range_per_season(self, one_station):
        """A station sampled each January is 2 ranges, not the decade between."""
        ds = FakeDataset(day_count_response(
            [("S1", "2020-01-01"), ("S1", "2020-01-02"),
             ("S1", "2030-01-01"), ("S1", "2030-01-02")]
        ))
        out = _extract_day_sets(ds, one_station, ["station_id"], LOG)
        assert out.loc["S1", "days"] == 4
        assert len(out.loc["S1", "day_ranges"]) == 2

    def test_bucket_index_is_decoded_not_taken_at_face_value(self, one_station):
        """Regression on the ERDDAP orderByCount bin-index behaviour.

        Read literally the fixture's timestamps are all in January 1970, so a
        missing decode collapses every row onto one day in the wrong decade.
        """
        ds = FakeDataset(day_count_response(
            [("S1", "2020-01-01"), ("S1", "2021-07-04")]
        ))
        out = _extract_day_sets(ds, one_station, ["station_id"], LOG)
        lows = [lo for lo, _ in out.loc["S1", "day_ranges"]]
        assert lows == [d("2020-01-01"), d("2021-07-04")]

    def test_per_feature_sets_are_independent(self):
        frame = profiles_frame([
            {"station_id": "S1", "time_min": "2020-01-01T00:00:00Z",
             "time_max": "2020-12-31T00:00:00Z"},
            {"station_id": "S2", "time_min": "2020-01-01T00:00:00Z",
             "time_max": "2020-12-31T00:00:00Z"},
        ])
        ds = FakeDataset(day_count_response(
            [("S1", "2020-03-01"), ("S2", "2020-03-01"), ("S2", "2020-04-01")]
        ))
        out = _extract_day_sets(ds, frame, ["station_id"], LOG)
        assert out.loc["S1", "days"] == 1
        assert out.loc["S2", "days"] == 2

    def test_days_never_exceeds_the_span(self, one_station):
        ds = FakeDataset(day_count_response(
            [("S1", f"2020-01-{n:02d}") for n in range(1, 11)]
        ))
        out = _extract_day_sets(ds, one_station, ["station_id"], LOG)
        span_days = (d("2020-12-31") - d("2020-01-01")).days + 1
        assert out.loc["S1", "days"] <= span_days

    def test_query_groups_time_into_utc_days(self, one_station):
        ds = FakeDataset(day_count_response([("S1", "2020-03-01")]))
        _extract_day_sets(ds, one_station, ["station_id"], LOG)
        assert "time/86400" in ds.queries[0]

    def test_counted_variable_differs_from_grouped(self, one_station):
        """ERDDAP returns the bins with no count column when the counted
        variable is one of the grouped ones."""
        ds = FakeDataset(day_count_response([("S1", "2020-03-01")]))
        _extract_day_sets(ds, one_station, ["station_id"], LOG)
        assert ds.queries[0].startswith("station_id,time,latitude")


class TestFallsBackInsteadOfFailing:
    """Every miss returns None so the caller uses the span. Losing the day set
    costs accuracy; raising here would cost the whole dataset."""

    @pytest.mark.parametrize(
        "error", [ResponseTooLargeError("too big"), HTTPError("500")]
    )
    def test_query_error_falls_back(self, one_station, error):
        ds = FakeDataset(raises=error)
        assert _extract_day_sets(ds, one_station, ["station_id"], LOG) is None

    def test_empty_response_falls_back(self, one_station):
        # An ERDDAP too old for orderBy interval grouping answers 500 with a
        # body the client turns into an empty frame rather than raising.
        ds = FakeDataset(pd.DataFrame())
        assert _extract_day_sets(ds, one_station, ["station_id"], LOG) is None

    def test_unparseable_dates_fall_back(self, one_station):
        ds = FakeDataset(pd.DataFrame(
            {"station_id": ["S1"], "time": ["not-a-date"], "latitude": [1]}
        ))
        assert _extract_day_sets(ds, one_station, ["station_id"], LOG) is None

    def test_unusable_time_bounds_fall_back(self):
        frame = profiles_frame(
            [{"station_id": "S1", "time_min": "", "time_max": ""}]
        )
        ds = FakeDataset(day_count_response([("S1", "2020-03-01")]))
        assert _extract_day_sets(ds, frame, ["station_id"], LOG) is None
        assert ds.queries == []  # never even asked

    def test_oversized_request_is_not_issued(self):
        """features x days over the cap falls back without touching the server.

        The response cap would reject it anyway, and unlike the optional
        enrichments a raised ResponseTooLargeError here would lose the dataset.
        """
        rows = [
            {"station_id": f"S{n}", "time_min": "1900-01-01T00:00:00Z",
             "time_max": "2025-01-01T00:00:00Z"}
            for n in range(1000)
        ]
        frame = profiles_frame(rows)
        span_days = (d("2025-01-01") - d("1900-01-01")).days
        assert len(frame) * span_days > MAX_DAY_COUNT_ROWS
        ds = FakeDataset(day_count_response([("S1", "2020-03-01")]))
        assert _extract_day_sets(ds, frame, ["station_id"], LOG) is None
        assert ds.queries == []

    def test_a_large_but_plausible_dataset_is_still_asked(self, one_station):
        """The cap must not skip the intermittent datasets it exists to help.

        Measured live: a 390-station Hakai set estimates 2,028,390 rows and
        returns 16,524. Sizing the cap to the estimate would have skipped it.
        """
        rows = [
            {"station_id": f"S{n}", "time_min": "2010-01-01T00:00:00Z",
             "time_max": "2025-01-01T00:00:00Z"}
            for n in range(390)
        ]
        frame = profiles_frame(rows)
        ds = FakeDataset(day_count_response([("S0", "2020-03-01")]))
        _extract_day_sets(ds, frame, ["station_id"], LOG)
        assert len(ds.queries) == 1


class TestAwkwardCfRoleVariables:
    """Real datasets put cf_role on variables the query also needs."""

    def test_cf_role_on_time_is_dropped_from_the_grouping(self):
        """mpoSgdoADCP tags cf_role=profile_id on `time` itself.

        Left in, the variable list repeats time and ERDDAP answers 400; and
        grouping by the raw time alongside its own day bucket would ask for one
        group per record.
        """
        frame = profiles_frame([
            {"id": "A", "time_min": "2020-01-01T00:00:00Z",
             "time_max": "2020-12-31T00:00:00Z"},
        ], index_name="id")
        ds = FakeDataset(day_count_response([("A", "2020-03-01")], index_name="id"))
        _extract_day_sets(ds, frame, ["id", "time"], LOG)
        request_vars = ds.queries[0].split("%26")[0]
        assert request_vars.split(",").count("time") == 1
        assert request_vars.startswith("id,time,")

    def test_counted_variable_avoids_the_grouped_ones(self):
        """orderByCount returns no count column for a variable it grouped on."""
        frame = profiles_frame([
            {"latitude": "48.5", "time_min": "2020-01-01T00:00:00Z",
             "time_max": "2020-12-31T00:00:00Z"},
        ], index_name="latitude")
        ds = FakeDataset(pd.DataFrame())
        _extract_day_sets(ds, frame, ["latitude"], LOG)
        request_vars = ds.queries[0].split("%26")[0].split(",")
        assert request_vars[-1] == "longitude"


class TestIndexAlignment:
    """The returned frame is joined onto the feature frame by index. A mismatch
    there does not raise — it yields NaN and silently puts every row back on the
    span, which is the defect this whole file is about."""

    def test_numeric_feature_ids_still_match(self):
        """distinct() reads an integer station id as int64; the count response
        is cast to str. Joined raw, those never meet."""
        frame = pd.DataFrame({
            "station_id": [101, 102],
            "time_min": ["2020-01-01T00:00:00Z"] * 2,
            "time_max": ["2020-12-31T00:00:00Z"] * 2,
        }).set_index("station_id")
        ds = FakeDataset(day_count_response(
            [(101, "2020-03-01"), (102, "2020-03-01"), (102, "2020-04-01")]
        ))
        out = _extract_day_sets(ds, frame, ["station_id"], LOG)
        assert out is not None
        assert out["days"].tolist() == [1, 2]
        assert out.index.equals(frame.index)

    def test_result_is_indexed_like_the_feature_frame(self, one_station):
        ds = FakeDataset(day_count_response([("S1", "2020-03-01")]))
        out = _extract_day_sets(ds, one_station, ["station_id"], LOG)
        assert out.index.equals(one_station.index)

    def test_feature_with_no_days_gets_an_empty_set_not_nan(self):
        """A station absent from the count response keeps an empty day set, so
        the web-api reads it as unknown and falls back per row."""
        frame = pd.DataFrame({
            "station_id": ["S1", "S2"],
            "time_min": ["2020-01-01T00:00:00Z"] * 2,
            "time_max": ["2020-12-31T00:00:00Z"] * 2,
        }).set_index("station_id")
        ds = FakeDataset(day_count_response([("S1", "2020-03-01")]))
        out = _extract_day_sets(ds, frame, ["station_id"], LOG)
        assert out.loc["S1", "days"] == 1
        assert out.loc["S2", "day_ranges"] == []

    def test_no_feature_matching_at_all_falls_back(self, one_station):
        ds = FakeDataset(day_count_response([("SOMETHING_ELSE", "2020-03-01")]))
        assert _extract_day_sets(ds, one_station, ["station_id"], LOG) is None


class TestHandlerGating:
    """Only types whose features can span more than one day pay for the extra
    request. A Profile feature is a single cast, so its span IS its day set."""

    def test_timeseries_types_harvest_day_sets(self):
        assert TimeSeriesHandler().features_span_multiple_days is True
        assert TimeSeriesProfileHandler().features_span_multiple_days is True

    def test_single_cast_type_does_not(self):
        assert ProfileHandler().features_span_multiple_days is False


class TestDaySetHelpers:
    """days_to_ranges / merge_ranges are the Python twins of day_union_days
    (database/8_range_functions.sql); the two must agree."""

    def test_runs_are_maximal(self):
        runs = days_to_ranges([d("2020-01-01"), d("2020-01-02"), d("2020-01-04")])
        assert runs == [(d("2020-01-01"), d("2020-01-03")),
                        (d("2020-01-04"), d("2020-01-05"))]

    def test_unsorted_and_duplicate_input(self):
        runs = days_to_ranges([d("2020-01-03"), d("2020-01-01"), d("2020-01-01"),
                               d("2020-01-02")])
        assert runs == [(d("2020-01-01"), d("2020-01-04"))]

    def test_missing_days_are_dropped(self):
        assert days_to_ranges([pd.NaT, None]) == []
        assert total_days([]) == 0

    def test_timestamps_are_floored_to_the_day(self):
        runs = days_to_ranges([pd.Timestamp("2020-01-01T23:00Z"),
                               pd.Timestamp("2020-01-01T01:00Z")])
        assert total_days(runs) == 1

    @pytest.mark.parametrize(
        "a,b,expected_runs,expected_days",
        [
            (("2020-01-01", "2020-01-11"), ("2020-01-06", "2020-01-21"), 1, 20),
            (("2020-01-01", "2020-01-11"), ("2020-01-11", "2020-01-21"), 1, 20),
            (("2020-01-01", "2020-01-02"), ("2030-01-01", "2030-01-02"), 2, 2),
        ],
        ids=["overlapping", "abutting", "disjoint"],
    )
    def test_merge_matches_day_union_days(self, a, b, expected_runs, expected_days):
        merged = merge_ranges([[(d(a[0]), d(a[1]))], [(d(b[0]), d(b[1]))]])
        assert len(merged) == expected_runs
        assert total_days(merged) == expected_days

    def test_merging_identical_copies_counts_once(self):
        """The 59-filename republish case: one deployment, not 59 deployments."""
        one = [(d("2014-08-20"), d("2015-08-31"))]
        merged = merge_ranges([one] * 59)
        assert merged == one
        assert total_days(merged) == 376

    def test_merge_of_nothing(self):
        assert merge_ranges([[], None]) == []

    def test_group_clause_shape(self):
        assert day_bucket_group(["station_id"]) == "station_id,time/86400"
        assert day_bucket_group([]) == "time/86400"


class TestSerialisationRoundTrips:
    """A day set crosses two boundaries with different rules, and getting
    either wrong silently reverts every row to the span fallback."""

    def test_csv_round_trip_is_literal_eval_safe(self):
        import ast

        runs = days_to_ranges([d("2020-01-01"), d("2020-01-02"), d("2021-03-01")])
        # The repr of a datetime.date is a constructor call, which literal_eval
        # rejects — ISO pairs are what survive the CSV.
        restored = ranges_from_iso(ast.literal_eval(repr(ranges_to_iso(runs))))
        assert restored == runs

    def test_ranges_from_iso_tolerates_dates(self):
        runs = [(d("2020-01-01"), d("2020-01-03"))]
        assert ranges_from_iso(runs) == runs

    def test_copy_literal_is_a_pg_array_of_dateranges(self):
        runs = [(d("2020-01-01"), d("2020-01-03"))]
        assert ranges_to_pg_literal(runs) == '{"[2020-01-01,2020-01-03)"}'
        assert ranges_to_pg_literal([]) == "{}"

    def test_to_sql_gets_range_objects_not_strings(self):
        """psycopg2 adapts a list of strings as text[], which PostgreSQL
        refuses to assign to a daterange[] column."""
        adapted = ranges_to_psycopg([(d("2020-01-01"), d("2020-01-03"))])
        assert [type(r).__name__ for r in adapted] == ["DateRange"]
        assert adapted[0].lower == d("2020-01-01")
        assert adapted[0].upper == d("2020-01-03")

    def test_loader_parses_day_ranges_from_csv_text(self):
        from cde_harvester.loading.loader import prepare_profiles_dataframe

        runs = days_to_ranges([d("2020-01-01"), d("2020-01-02")])
        frame = pd.DataFrame({
            "time_min": [pd.Timestamp("2020-01-01T00:00:00Z")],
            "time_max": [pd.Timestamp("2020-01-02T00:00:00Z")],
            "day_ranges": [repr(ranges_to_iso(runs))],
        })
        out = prepare_profiles_dataframe(frame)
        assert [type(r).__name__ for r in out["day_ranges"].iloc[0]] == ["DateRange"]

    def test_loader_tolerates_a_missing_day_set(self):
        """NaN is truthy, so a missing cell must be type-checked, not `or`-ed."""
        from cde_harvester.loading.loader import prepare_profiles_dataframe

        frame = pd.DataFrame({
            "time_min": [pd.Timestamp("2020-01-01T00:00:00Z")],
            "time_max": [pd.Timestamp("2020-01-02T00:00:00Z")],
            "day_ranges": [float("nan")],
        })
        out = prepare_profiles_dataframe(frame)
        assert out["day_ranges"].iloc[0] == []


class TestBucketIndexDecoding:
    def test_index_is_scaled_to_days(self):
        # day 18262 arrives as 18262 seconds past the epoch
        series = pd.Series(["1970-01-01T05:04:22Z"])
        out = bucket_index_to_day(series, ERDDAP.parse_erddap_dates)
        assert out.iloc[0] == pd.Timestamp("2020-01-01", tz="UTC")

    def test_real_timestamps_pass_through(self):
        """orderByMin/Max are not affected by the bin-index behaviour, so the
        decode has to leave a genuine timestamp alone."""
        series = pd.Series(["2020-01-01T13:45:00Z"])
        out = bucket_index_to_day(series, ERDDAP.parse_erddap_dates)
        assert out.iloc[0] == pd.Timestamp("2020-01-01", tz="UTC")
