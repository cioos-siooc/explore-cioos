"""Merging obis_cells rows that describe the same cell.

Two callers need exactly this operation, for the same reason:

  * the harvester, combining the partial cells it produces per occurrence chunk
    (`sources/obis/harvester.py`) -- the chunks hold disjoint occurrences of the
    same cells;
  * the db loader, deduplicating rows that are the SAME cell split by float
    noise before COPY (`loading/loader.py`).

Every aggregation below is associative and commutative, which is what makes
chunked aggregation exact rather than approximate: merging partials gives the
same answer as one pass over the concatenation.

`days` is the exception and is NOT aggregated directly. It is a distinct-day
COUNT, so it can be neither summed (a day present in two inputs would count
twice) nor maxed (inputs whose day sets do not overlap would understate it). It
is recomputed from the unioned `day_ranges`, which is the only input that knows
WHICH days rather than how many.
"""
import pandas as pd

from cde_harvester.core.day_sets import merge_ranges, total_days

CELL_KEY_COLS = ["dataset_id", "latitude", "longitude"]


def cell_aggregations(has_day_ranges=True):
    """The associative aggregation spec for `DataFrame.groupby(...).agg(**...)`."""
    aggregations = {
        "scientific_names": (
            "scientific_names",
            lambda lists: sorted({name for lst in lists for name in lst}),
        ),
        # n_records sums because the occurrence subsets behind the merged rows
        # really are disjoint -- whether they were split by chunk boundary or
        # by float noise.
        "n_records": ("n_records", "sum"),
        # Placeholder only: overwritten from the unioned day_ranges below when
        # they are available. max() is right only while the merged rows' day
        # sets overlap, and understates otherwise.
        "days": ("days", "max"),
        "time_min": ("time_min", "min"),
        "time_max": ("time_max", "max"),
        "depth_min": ("depth_min", "min"),
        "depth_max": ("depth_max", "max"),
    }
    if has_day_ranges:
        # Union, not max or concat. merge_ranges is the Python twin of the
        # day_union_days SQL, keeping `days` and `day_ranges` consistent.
        aggregations["day_ranges"] = ("day_ranges", merge_ranges)
    return aggregations


def merge_cells(cells, key_cols=None, has_day_ranges=True):
    """Group `cells` on `key_cols` and merge the duplicates into one row each."""
    key_cols = list(key_cols or CELL_KEY_COLS)
    agg = (
        cells.groupby(key_cols, dropna=False)
        .agg(**cell_aggregations(has_day_ranges))
        .reset_index()
    )
    if has_day_ranges:
        agg["days"] = agg["day_ranges"].apply(total_days)
    return agg


def merge_cell_partials(partials, dataset_id):
    """Combine the partial cells produced per occurrence chunk of one dataset.

    Empty partials are dropped rather than concatenated: an empty frame carries
    the OCCURRENCE columns (a chunk can be filtered down to nothing before the
    groupby ever runs), and letting one into the concat would widen the result
    with columns that are not cells columns.
    """
    frames = [p for p in partials if p is not None and not p.empty]
    if not frames:
        return pd.DataFrame()

    combined = pd.concat(frames, ignore_index=True)
    if "dataset_id" not in combined.columns:
        combined["dataset_id"] = dataset_id

    merged = merge_cells(combined)
    # Preserve the single-pass column order so the two paths are diffable.
    return merged[[c for c in frames[0].columns if c in merged.columns]]
