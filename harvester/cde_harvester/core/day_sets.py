"""Day sets — the unit the map's `days` metric counts.

A feature's day set is the UTC days it actually holds data on. The map unions
those sets across the features in a hex (`day_union_days` in
database/8_range_functions.sql) rather than adding day counts up, so overlapping
deployments don't multiply a year of coverage into a decade.

Stored as maximal runs of consecutive days — `daterange[]` with '[)' bounds —
because that is compact for the common case (a continuously-reporting mooring
is ONE range) and exact for the awkward one (a seasonal station is one range per
season, not the decades-long envelope between the first and last sample).

Every source builds its set the same way but reaches it differently:

  * trajectories  — in SQL, from the days the track was inside each hex
                    (`trajectory_build_hexes`, database/4_create_hexes.sql)
  * OBIS          — from each occurrence's date, in `aggregate_cells`
  * ERDDAP tabledap — from an `orderByCount(".../time/86400")` per feature

The two rendering helpers exist because the two load paths differ: obis_cells
goes through COPY, which does text→type coercion and so wants a PostgreSQL array
literal; profiles goes through `to_sql`, whose parameter binding does NOT coerce
text[] to daterange[] and so wants psycopg2's own range objects.
"""

import datetime

import pandas as pd
from psycopg2.extras import DateRange

# ERDDAP's `time/86400` interval buckets are epoch-aligned, i.e. UTC midnight —
# the same boundary the database counts distinct days on.
DAY_SECONDS = 86400

# A day-bucket INDEX is ~2e4; a real epoch timestamp is ~1.5e9. Nothing
# plausible sits in between, which is what makes the heuristic in
# bucket_index_to_day safe.
_BUCKET_INDEX_CEILING = 10**6


def day_bucket_group(group_variables):
    """The `orderByCount` group clause that buckets time into UTC days.

    e.g. ("station",) -> 'station,time/86400'
    """
    return ",".join(list(group_variables) + [f"time/{DAY_SECONDS}"])


def bucket_index_to_day(series, parse_dates):
    """Decode the grouped column of an interval-grouped `orderByCount`.

    ERDDAP returns the group's BUCKET INDEX, not the bucket value, formatted as
    if it were the column's own type: `time/86400` comes back as
    "1970-01-01T03:36:57Z", which is 13017 *seconds*, i.e. day index 13017
    (2005-08-15). Read at face value every row collapses onto 1970-01-01 —
    which is exactly how the old trajectory_cells.n_records was silently zeroed
    (docs/trajectory-coverage.md). `orderByMin`/`orderByMax` are NOT affected;
    they return the real extreme row, so they need no decoding.

    `parse_dates` is the ERDDAP date parser, passed in so this module stays
    independent of the ERDDAP client.
    """
    parsed = parse_dates(series)
    # Unparseable values coerce to NaT, whose int64 form is the int64 minimum —
    # big enough to defeat the magnitude test below AND to overflow the
    # conversion back. Mask them out and let them stay NaT; the caller drops
    # them.
    usable = parsed.notna()
    epoch = parsed.astype("int64") // 10**9
    if usable.any() and epoch[usable].abs().max() < _BUCKET_INDEX_CEILING:
        epoch = epoch * DAY_SECONDS
    return pd.to_datetime(epoch.where(usable), unit="s", utc=True).dt.floor("D")


def days_to_ranges(days):
    """Collapse a set of days into maximal runs of consecutive days.

    Returns a list of (start, end_exclusive) `datetime.date` pairs, ordered.
    Duplicates and unsorted input are fine; NaT/None are dropped.

    A run is closed as soon as the next day is not the following calendar day,
    so a station sampled every January yields one range per January rather than
    the decades-long envelope that spans them.
    """
    seen = sorted(
        {
            d.date() if isinstance(d, (pd.Timestamp, datetime.datetime)) else d
            for d in days
            if d is not None and not pd.isna(d)
        }
    )
    if not seen:
        return []

    one_day = datetime.timedelta(days=1)
    runs = []
    lo = prev = seen[0]
    for day in seen[1:]:
        if day == prev + one_day:
            prev = day
            continue
        runs.append((lo, prev + one_day))
        lo = prev = day
    runs.append((lo, prev + one_day))
    return runs


def merge_ranges(range_lists):
    """Union several run lists into one. The Python twin of day_union_days().

    Used when rows that turn out to be the same feature are merged at load
    time: their day sets overlap, so neither concatenating the runs nor taking
    the longer list is right.
    """
    runs = sorted(
        (lo, hi)
        for lst in range_lists
        if lst is not None and len(lst)
        for lo, hi in lst
    )
    if not runs:
        return []

    merged = [runs[0]]
    for lo, hi in runs[1:]:
        prev_lo, prev_hi = merged[-1]
        if lo <= prev_hi:  # overlaps or abuts the current run
            merged[-1] = (prev_lo, max(prev_hi, hi))
        else:
            merged.append((lo, hi))
    return merged


def total_days(ranges):
    """Number of days a run list covers. Mirrors day_union_days() in SQL.

    The runs are disjoint and non-abutting by construction, so this is a plain
    sum — no merge needed.
    """
    return sum((hi - lo).days for lo, hi in ranges or [])


def ranges_to_iso(ranges):
    """Run list as plain ISO-string pairs, for the CSV round-trip.

    The harvester writes list columns to the CSV as Python reprs and the loader
    reads them back with ast.literal_eval, which only accepts literals — the
    repr of a datetime.date is a constructor call, so the dates cannot go
    through as themselves.
    """
    return [[lo.isoformat(), hi.isoformat()] for lo, hi in ranges or []]


def ranges_from_iso(pairs):
    """Inverse of ranges_to_iso. Tolerates already-parsed dates."""
    return [
        (
            lo if isinstance(lo, datetime.date) else datetime.date.fromisoformat(lo),
            hi if isinstance(hi, datetime.date) else datetime.date.fromisoformat(hi),
        )
        for lo, hi in pairs or []
    ]


def ranges_to_pg_literal(ranges):
    """PostgreSQL `daterange[]` literal, for the COPY load path.

    COPY runs each field through the column's input function, so the text form
    is coerced to daterange[] for free — unlike INSERT parameter binding, which
    rejects text[] against a daterange[] column.
    """
    return "{" + ",".join(f'"[{lo.isoformat()},{hi.isoformat()})"' for lo, hi in ranges or []) + "}"


def ranges_to_psycopg(ranges):
    """psycopg2 DateRange objects, for the `to_sql` load path.

    to_sql binds parameters rather than going through an input function, and
    psycopg2 adapts text as text — assigning it to a daterange[] column raises
    DatatypeMismatch. Its own range type adapts correctly.
    """
    return [DateRange(lo, hi, "[)") for lo, hi in ranges or []]
