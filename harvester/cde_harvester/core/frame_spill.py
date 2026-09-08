"""Bounded-memory accumulation of many small DataFrames.

A harvest builds its output tables one dataset at a time. Holding every
dataset's frame in one Python list for the whole run, then concatenating at the
end, is what OOM-killed a 6GB container partway through a full OBIS run
(dataset 296/971) and again on a large-profile ERDDAP run: retained per-dataset
DataFrames plus never-reclaimed pandas allocator arenas ratchet RSS up with no
release point until the final concat.

`SpillSet` bounds that. Frames are appended per named table; every
`flush_every` checkpoints each table's pending batch is concatenated ONCE,
pickled to a shared temp dir and dropped from memory. `collect()` reassembles.
Peak memory is therefore set by the flush interval, not by the dataset count.

It also removes the other half of the problem: growing an accumulator with
`df = pd.concat([df, new])` inside the loop reallocates and copies the ENTIRE
accumulated frame on every iteration, so allocation is quadratic in dataset
count and peak RSS is ~2x the accumulated frame at every step. Appending to a
list and concatenating once per flush is linear.

Pickle, not parquet: this is an ephemeral in-process handoff, not a durable or
interchange format, it round-trips dtypes exactly, and pyarrow/fastparquet
aren't dependencies here.
"""
import gc
import logging
import os
import tempfile

import pandas as pd

logger = logging.getLogger(__name__)


class SpillSet:
    """Several named DataFrame accumulators sharing one temp dir and one flush
    cadence.

    Use as a context manager so the temp dir is removed even when the harvest
    raises:

        with SpillSet(flush_every=50) as spills:
            spills.register("profiles", ProfileSchema.to_schema().columns.keys())
            for dataset in datasets:
                spills.append("profiles", features)
                spills.checkpoint()          # once per dataset
            df = spills.collect("profiles")  # flushes the trailing partial

    `checkpoint()` is driven by the caller rather than by `append()` so that
    several tables filled from the same dataset flush together, on dataset
    boundaries, with one gc pass between them.
    """

    def __init__(self, flush_every=50, prefix="harvest_spill_"):
        if flush_every < 1:
            raise ValueError("flush_every must be >= 1")
        self.flush_every = flush_every
        self._prefix = prefix
        self._columns = {}
        self._pending = {}
        self._chunk_paths = {}
        self._checkpoints = 0
        self._dir_ctx = None
        self._dir = None

    def __enter__(self):
        self._dir_ctx = tempfile.TemporaryDirectory(prefix=self._prefix)
        self._dir = self._dir_ctx.__enter__()
        return self

    def __exit__(self, exc_type, exc, tb):
        self._pending.clear()
        self._chunk_paths.clear()
        dir_ctx, self._dir_ctx, self._dir = self._dir_ctx, None, None
        if dir_ctx is not None:
            dir_ctx.__exit__(exc_type, exc, tb)
        return False

    def register(self, name, columns):
        """Declare a table and the columns its empty frame must have.

        The column list is also the output ordering: `collect()` emits these
        first, in this order, then any extra columns the appended frames
        carried. A harvest that appends nothing still gets a correctly shaped
        empty frame, which is what keeps a no-op run from looking like a
        source with no data.
        """
        self._columns[name] = list(columns)
        self._pending.setdefault(name, [])
        self._chunk_paths.setdefault(name, [])

    def append(self, name, df):
        """Queue a frame. None and empty frames are dropped — they contribute
        no rows and would only muddy dtype resolution at concat time."""
        if df is None or df.empty:
            return
        self._pending[name].append(df)

    def checkpoint(self):
        """Mark one unit of work (one dataset) done; flush on the interval."""
        self._checkpoints += 1
        if self._checkpoints % self.flush_every == 0:
            self.flush()

    def flush(self):
        """Write every table's pending batch to disk and free the frames."""
        if self._dir is None:
            raise RuntimeError("SpillSet must be used as a context manager")
        wrote = False
        for name, pending in self._pending.items():
            if not pending:
                continue
            chunk = pd.concat(pending, ignore_index=True)
            path = os.path.join(
                self._dir, f"{name}_{len(self._chunk_paths[name]):05d}.pkl"
            )
            chunk.to_pickle(path)
            self._chunk_paths[name].append(path)
            pending.clear()
            del chunk
            wrote = True
        if wrote:
            # Return the freed arenas rather than letting them ratchet: the
            # whole point of flushing is that RSS goes back down.
            gc.collect()

    def collect(self, name):
        """Reassemble one table. Flushes the trailing partial batch first, so
        callers never have to remember a final flush."""
        self.flush()
        paths = self._chunk_paths[name]
        columns = self._columns[name]
        if not paths:
            return pd.DataFrame(columns=columns)
        df = pd.concat([pd.read_pickle(p) for p in paths], ignore_index=True)
        # Every registered column, in registration order, then anything extra
        # the frames carried. This reproduces what the previous
        # seed-an-empty-frame-and-concat-onto-it code emitted: the seed decided
        # the output columns, so a schema column that no dataset happened to
        # fill still appeared (all-NaN) and still reached the CSV header. Doing
        # it here rather than by concatenating the empty frame keeps that shape
        # without letting an empty frame take part in dtype resolution, which
        # in pandas 1.5 would demote typed columns to object.
        ordered = list(columns) + [c for c in df.columns if c not in columns]
        return df.reindex(columns=ordered)
