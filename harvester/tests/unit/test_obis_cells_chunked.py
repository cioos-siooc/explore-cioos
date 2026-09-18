"""Per-chunk aggregation must equal a single pass over the concatenation.

Every aggregation in `_aggregate_chunk` is associative and commutative, so
partials from disjoint chunks can be merged. The two that are NOT are handled
deliberately:

  * `days` is recomputed from the merged `day_ranges` (nunique cannot be summed
    -- a day present in two chunks would be counted twice).
  * the depth `fillna(0)` is deferred to `_finalize_cells` -- doing it per chunk
    turns "no depth recorded in this chunk" into a real 0.0 that then wins a
    min()/max() against another chunk's real depth.
"""
import pandas as pd
import pytest
from cde_harvester.core.obis_cells import merge_cell_partials
from cde_harvester.sources.obis.harvester import OBISHarvester

DAY_MS = 86_400_000
BASE_MS = 1_600_000_000_000


@pytest.fixture
def harvester(tmp_path):
    return OBISHarvester(limit_dataset_ids=["ds-1"], folder=str(tmp_path))


def occ(lat=50.0, lon=-60.0, depth_min=None, depth_max=None, day=0, name="sp"):
    return {
        "decimalLatitude": lat,
        "decimalLongitude": lon,
        "minimumDepthInMeters": depth_min,
        "maximumDepthInMeters": depth_max,
        "date_start": BASE_MS + day * DAY_MS,
        "date_end": BASE_MS + day * DAY_MS,
        "scientificName": name,
    }


def chunked(h, chunks):
    partials = [h._aggregate_chunk("ds-1", c, apply_filter=False) for c in chunks]
    return h._finalize_cells(merge_cell_partials(partials, "ds-1"))


def single(h, rows):
    return h.aggregate_cells("ds-1", rows, apply_filter=False)


class TestDepthsAcrossChunkBoundary:
    """The defect that makes _finalize_cells necessary. Measured, not theoretical."""

    def test_null_depths_in_one_chunk_do_not_zero_the_other_chunks_depth(self, harvester):
        a = [occ(depth_min=None, depth_max=None), occ(depth_min=None, depth_max=None)]
        b = [occ(depth_min=15.0, depth_max=40.0), occ(depth_min=20.0, depth_max=30.0)]
        want = single(harvester, a + b)
        got = chunked(harvester, [a, b])
        assert got["depth_min"].iloc[0] == want["depth_min"].iloc[0] == 15.0
        assert got["depth_max"].iloc[0] == want["depth_max"].iloc[0] == 40.0

    def test_negative_depths_survive(self, harvester):
        # Intertidal / above-datum records are real in OBIS, and a per-chunk
        # fillna(0) beats them on max().
        a = [occ(depth_min=None, depth_max=None)]
        b = [occ(depth_min=-5.0, depth_max=-2.0)]
        want = single(harvester, a + b)
        got = chunked(harvester, [a, b])
        assert got["depth_max"].iloc[0] == want["depth_max"].iloc[0] == -2.0
        assert got["depth_min"].iloc[0] == want["depth_min"].iloc[0] == -5.0

    def test_all_null_depths_still_become_zero(self, harvester):
        rows = [occ(depth_min=None, depth_max=None)]
        got = chunked(harvester, [rows])
        assert got["depth_min"].iloc[0] == 0
        assert got["depth_max"].iloc[0] == 0


class TestChunkInvariance:
    def test_days_union_not_sum_when_a_day_spans_two_chunks(self, harvester):
        # Day 0 appears in BOTH chunks: summing per-chunk nunique would say 3.
        a = [occ(day=0), occ(day=1)]
        b = [occ(day=0), occ(day=2)]
        want = single(harvester, a + b)
        got = chunked(harvester, [a, b])
        assert got["days"].iloc[0] == want["days"].iloc[0] == 3

    def test_undated_occurrences_contribute_no_days(self, harvester):
        rows = [occ(day=0), dict(occ(), date_start=None, date_end=None)]
        want = single(harvester, rows)
        got = chunked(harvester, [[rows[0]], [rows[1]]])
        assert got["days"].iloc[0] == want["days"].iloc[0] == 1
        assert got["n_records"].iloc[0] == want["n_records"].iloc[0] == 2

    def test_scientific_names_are_unioned_and_sorted(self, harvester):
        a = [occ(name="beta"), occ(name="alpha")]
        b = [occ(name="alpha"), occ(name="gamma")]
        got = chunked(harvester, [a, b])
        assert got["scientific_names"].iloc[0] == ["alpha", "beta", "gamma"]

    def test_all_null_names_in_one_chunk(self, harvester):
        a = [occ(name=None), occ(name=None)]
        b = [occ(name="alpha")]
        want = single(harvester, a + b)
        got = chunked(harvester, [a, b])
        assert got["scientific_names"].iloc[0] == want["scientific_names"].iloc[0] == ["alpha"]

    @pytest.mark.parametrize("n_chunks", [1, 2, 3, 7, 50])
    def test_result_is_identical_regardless_of_chunk_count(self, harvester, n_chunks):
        rows = [
            occ(
                lat=50.0 + (i % 5) * 0.2,
                lon=-60.0 - (i % 3) * 0.2,
                depth_min=None if i % 4 == 0 else float(i % 17),
                depth_max=None if i % 5 == 0 else float(i % 23),
                day=i % 11,
                name=None if i % 9 == 0 else f"sp{i % 6}",
            )
            for i in range(100)
        ]
        size = max(1, len(rows) // n_chunks)
        chunks = [rows[i:i + size] for i in range(0, len(rows), size)]

        want = single(harvester, rows).sort_values(["latitude", "longitude"]).reset_index(drop=True)
        got = chunked(harvester, chunks).sort_values(["latitude", "longitude"]).reset_index(drop=True)
        got = got[want.columns]
        pd.testing.assert_frame_equal(want, got, check_like=True)


class TestEmptyInputs:
    def test_empty_chunk_list_yields_an_empty_frame(self, harvester):
        assert merge_cell_partials([], "ds-1").empty

    def test_zero_row_chunk_between_real_chunks_is_ignored(self, harvester):
        a = [occ(day=0)]
        b = [occ(day=1)]
        want = single(harvester, a + b)
        got = chunked(harvester, [a, [], b])
        assert got["days"].iloc[0] == want["days"].iloc[0] == 2


class TestOutOfRangeDates:
    """OBIS carries dates outside datetime64[ns] (fossil/historical records).

    They must become NaT, as they always did. The hazard is that pandas 1.5.3
    does not honour errors="coerce" for the nullable Int64 dtype, and duckdb
    hands back Int64 for exactly those chunks that contain a NULL -- so this
    only fires on a chunk carrying both a null date and an ancient one.
    """

    ANCIENT_MS = -10_849_593_600_000  # 1626-01-01, below the 1677 floor

    @pytest.mark.parametrize("dtype", ["int64", "Int64", "float64", "object"])
    def test_ancient_dates_become_nat_for_every_dtype_duckdb_may_hand_back(self, harvester, dtype):
        rows = pd.DataFrame({
            "decimalLatitude": [50.0, 50.0],
            "decimalLongitude": [-60.0, -60.0],
            "minimumDepthInMeters": [1.0, 2.0],
            "maximumDepthInMeters": [3.0, 4.0],
            "date_start": pd.Series([BASE_MS, self.ANCIENT_MS], dtype=dtype),
            "date_end": pd.Series([BASE_MS, self.ANCIENT_MS], dtype=dtype),
            "scientificName": ["sp", "sp"],
        })
        cells = harvester.aggregate_cells("ds-1", rows, apply_filter=False)
        assert cells["n_records"].iloc[0] == 2, "the ancient row is kept, only its date is dropped"
        assert cells["days"].iloc[0] == 1, "only the in-range date contributes a day"

    def test_a_null_alongside_an_ancient_date_does_not_raise(self, harvester):
        # The real-world shape: duckdb returns Int64 because of the null, and
        # errors="coerce" silently stops working for that dtype.
        rows = pd.DataFrame({
            "decimalLatitude": [50.0, 50.0, 50.0],
            "decimalLongitude": [-60.0, -60.0, -60.0],
            "minimumDepthInMeters": [1.0, 2.0, 3.0],
            "maximumDepthInMeters": [3.0, 4.0, 5.0],
            "date_start": pd.array([BASE_MS, self.ANCIENT_MS, None], dtype="Int64"),
            "date_end": pd.array([BASE_MS, self.ANCIENT_MS, None], dtype="Int64"),
            "scientificName": ["sp", "sp", "sp"],
        })
        cells = harvester.aggregate_cells("ds-1", rows, apply_filter=False)
        assert cells["n_records"].iloc[0] == 3
        assert cells["days"].iloc[0] == 1
