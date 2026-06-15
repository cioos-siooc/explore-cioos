"""
HarvestRunner — orchestrates a fully-instrumented harvest run.

Runs the same harvest_erddap() function used in production while
LogCapture and HttpCallTracker are active, then bundles every artifact
(DataFrames, log records, HTTP calls) into a HarvestArtifacts object
for downstream analysis.
"""

from __future__ import annotations

import queue
import threading
import time
import traceback
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

import pandas as pd

from cde_harvester.harvest_erddap import harvest_erddap
from cde_harvester.ckan.create_ckan_erddap_link import get_ckan_records

from .collectors import LogCapture, HttpCallTracker


# ─── Artifacts data class ──────────────────────────────────────────────────────

@dataclass
class HarvestArtifacts:
    """
    Everything produced and observed during a single validation run.
    Passed intact to the analyzer.
    """
    run_id: str
    config: dict
    start_time: datetime
    end_time: datetime

    # Output DataFrames (aggregated across all servers)
    profiles: pd.DataFrame
    datasets: pd.DataFrame
    variables: pd.DataFrame
    skipped: pd.DataFrame

    # Instrumentation captures
    log_capture: LogCapture
    http_tracker: HttpCallTracker

    # Per-server breakdown: url → [profiles_df, datasets_df, variables_df, skipped_df]
    per_server: dict = field(default_factory=dict)

    # Set if the harvest loop itself crashed (not individual dataset errors)
    fatal_error: Optional[str] = None

    @property
    def duration_s(self) -> float:
        return (self.end_time - self.start_time).total_seconds()

    @property
    def duration_human(self) -> str:
        secs = int(self.duration_s)
        if secs < 60:
            return f"{secs}s"
        m, s = divmod(secs, 60)
        if m < 60:
            return f"{m}m {s:02d}s"
        h, m = divmod(m, 60)
        return f"{h}h {m:02d}m {s:02d}s"


# ─── Runner ────────────────────────────────────────────────────────────────────

class HarvestRunner:
    """
    Runs the harvest pipeline with all collectors active, then returns a
    fully-populated HarvestArtifacts.

    The runner intentionally mirrors the threading model used in
    cde_harvester/__main__.py so that the validation run exercises the
    same code paths as production.
    """

    def __init__(self, config: dict, run_id: str) -> None:
        self.config = config
        self.run_id = run_id
        self.log_capture = LogCapture()
        self.http_tracker = HttpCallTracker()

    def run(self) -> HarvestArtifacts:
        """
        Execute the harvest with instrumentation and return HarvestArtifacts.
        Never raises — fatal errors are captured inside the artifact.
        """
        erddap_urls: list[str] = self.config.get("erddap_urls") or []
        limit_ids: Optional[list[str]] = (
            self.config.get("dataset_ids") or None
        )
        cache: bool = bool(self.config.get("cache", False))
        max_workers: int = int(self.config.get("max-workers", 1))

        per_server: dict = {}
        all_results: list = []
        fatal_error: Optional[str] = None
        start = datetime.now()

        with self.log_capture, self.http_tracker:
            try:
                self._run_threaded(
                    erddap_urls, limit_ids, cache, max_workers,
                    per_server, all_results,
                )
            except Exception:
                fatal_error = traceback.format_exc()

        end = datetime.now()

        profiles = _concat([r[0] for r in all_results])
        datasets = _concat([r[1] for r in all_results])
        variables = _concat([r[2] for r in all_results])
        skipped = _concat([r[3] for r in all_results])

        return HarvestArtifacts(
            run_id=self.run_id,
            config=self.config,
            start_time=start,
            end_time=end,
            profiles=profiles,
            datasets=datasets,
            variables=variables,
            skipped=skipped,
            log_capture=self.log_capture,
            http_tracker=self.http_tracker,
            per_server=per_server,
            fatal_error=fatal_error,
        )

    # ── Internal threading ────────────────────────────────────────────────────

    def _run_threaded(
        self,
        erddap_urls: list[str],
        limit_ids: Optional[list[str]],
        cache: bool,
        max_workers: int,
        per_server: dict,
        all_results: list,
    ) -> None:
        """
        Mirrors the queue + daemon-thread pattern from cde_harvester/__main__.py
        so the validation run exercises the same concurrency model.
        """
        q: queue.Queue = queue.Queue()
        lock = threading.Lock()

        def worker() -> None:
            while True:
                (url, limit, use_cache) = q.get()
                try:
                    server_result: list = []
                    harvest_erddap(url, server_result, limit, use_cache)
                    if server_result:
                        with lock:
                            per_server[url] = server_result[0]
                            all_results.append(server_result[0])
                except Exception:
                    pass  # logged by harvest_erddap; captured by LogCapture
                finally:
                    time.sleep(0.1)
                    q.task_done()

        for _ in range(max(1, max_workers)):
            t = threading.Thread(target=worker, daemon=True)
            t.start()

        for url in erddap_urls:
            q.put((url, limit_ids, cache))

        q.join()


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _concat(frames: list) -> pd.DataFrame:
    """Concatenate a list of DataFrames, ignoring None and empty frames."""
    non_empty = [f for f in frames if f is not None and len(f) > 0]
    if not non_empty:
        return pd.DataFrame()
    return pd.concat(non_empty, ignore_index=True)
