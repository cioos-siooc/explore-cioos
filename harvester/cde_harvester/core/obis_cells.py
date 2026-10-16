"""Merging obis_cells rows that describe the same cell.

Used by the harvester (partials per occurrence chunk) and the loader (the same
cell split by float noise). Every aggregation is associative, so chunked
aggregation is exact. `days` is a distinct-day count, so it is recomputed from
the unioned `day_ranges` instead.
"""
import pandas as pd

from cde_harvester.core.day_sets import merge_ranges, total_days

CELL_KEY_COLS = ["dataset_id", "latitude", "longitude"]


def cell_aggregations(has_day_ranges=True):
    aggregations = {
        "scientific_names": (
            "scientific_names",
            lambda lists: sorted({name for lst in lists for name in lst}),
        ),
        "n_records": ("n_records", "sum"),
        # Placeholder; overwritten from day_ranges when available.
        "days": ("days", "max"),
        "time_min": ("time_min", "min"),
        "time_max": ("time_max", "max"),
        "depth_min": ("depth_min", "min"),
        "depth_max": ("depth_max", "max"),
    }
    if has_day_ranges:
        aggregations["day_ranges"] = ("day_ranges", merge_ranges)
    return aggregations


def merge_cells(cells, key_cols=None, has_day_ranges=True):
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
    """Empty partials carry the occurrence columns, so they are dropped."""
    frames = [p for p in partials if p is not None and not p.empty]
    if not frames:
        return pd.DataFrame()

    combined = pd.concat(frames, ignore_index=True)
    if "dataset_id" not in combined.columns:
        combined["dataset_id"] = dataset_id

    merged = merge_cells(combined)
    # Preserve the single-pass column order so the two paths are diffable.
    return merged[[c for c in frames[0].columns if c in merged.columns]]
