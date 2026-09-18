"""SpillSet returns freed pages to the OS, not just freed objects.

gc.collect() frees the Python objects; glibc keeps their pages on per-arena
free lists, so RSS ratchets across flushes. Measured over one OBIS run's flush
cadence: +272 MiB with gc.collect() alone, +35 MiB with malloc_trim as well.
"""
import pandas as pd
from cde_harvester.core import frame_spill
from cde_harvester.core.frame_spill import SpillSet


def test_flush_releases_pages_after_writing(monkeypatch):
    calls = []
    monkeypatch.setattr(frame_spill, "_release_freed_pages", lambda: calls.append(1))

    with SpillSet(flush_every=2, prefix="test_spill_") as spills:
        spills.register("t", ["a"])
        for i in range(4):
            spills.append("t", pd.DataFrame({"a": [i]}))
            spills.checkpoint()
        assert calls, "flush() must return freed pages to the OS, not only run gc"
        assert len(calls) == 2, "one release per flush that actually wrote"
        assert spills.collect("t").shape[0] == 4


def test_flush_does_not_release_when_nothing_was_written(monkeypatch):
    calls = []
    monkeypatch.setattr(frame_spill, "_release_freed_pages", lambda: calls.append(1))

    with SpillSet(flush_every=1, prefix="test_spill_") as spills:
        spills.register("t", ["a"])
        spills.checkpoint()  # nothing appended
        assert calls == []


def test_release_is_a_no_op_without_glibc(monkeypatch):
    # musl/macOS resolve no libc.so.6; the trim is an optimization, so the
    # harvest must still run.
    monkeypatch.setattr(frame_spill, "_libc", None)
    frame_spill._release_freed_pages()
