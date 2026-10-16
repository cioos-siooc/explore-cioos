"""Bounded-memory accumulation of many small DataFrames.

Holding every dataset's frame until a final concat OOM-killed a 6GB container
mid OBIS run. Every `flush_every` checkpoints each table's pending batch is
concatenated once, pickled to a temp dir and dropped, so peak memory is set by
the flush interval, not the dataset count.
"""
import ctypes
import gc
import logging
import os
import tempfile

import pandas as pd

logger = logging.getLogger(__name__)

try:
    _libc = ctypes.CDLL("libc.so.6")
    _libc.malloc_trim.argtypes = [ctypes.c_size_t]
    _libc.malloc_trim.restype = ctypes.c_int
except (OSError, AttributeError):
    # Not glibc (musl, macOS). The trim is an optimization, never a
    # correctness requirement, so run without it.
    _libc = None


def _release_freed_pages():
    """glibc keeps freed pages on its arena free lists; measured over one OBIS
    run: +272 MiB with `gc.collect()` alone, +35 MiB with this as well."""
    if _libc is not None:
        _libc.malloc_trim(0)


class SpillSet:
    """Named DataFrame accumulators sharing one temp dir and flush cadence.

    The caller drives `checkpoint()` (once per dataset) so tables filled from
    the same dataset flush together, on dataset boundaries.
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
        """`columns` also fixes the output order, and shapes the empty frame."""
        self._columns[name] = list(columns)
        self._pending.setdefault(name, [])
        self._chunk_paths.setdefault(name, [])

    def append(self, name, df):
        """Empty frames are dropped: they'd only muddy dtype resolution."""
        if df is None or df.empty:
            return
        self._pending[name].append(df)

    def checkpoint(self):
        self._checkpoints += 1
        if self._checkpoints % self.flush_every == 0:
            self.flush()

    def flush(self):
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
            gc.collect()
            _release_freed_pages()

    def collect(self, name):
        """Flushes the trailing partial batch first."""
        self.flush()
        paths = self._chunk_paths[name]
        columns = self._columns[name]
        if not paths:
            return pd.DataFrame(columns=columns)
        df = pd.concat([pd.read_pickle(p) for p in paths], ignore_index=True)
        # Reindex rather than concat an empty seed frame, which in pandas 1.5
        # would demote typed columns to object.
        ordered = list(columns) + [c for c in df.columns if c not in columns]
        return df.reindex(columns=ordered)
