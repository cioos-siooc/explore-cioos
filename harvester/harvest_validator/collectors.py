"""
Collectors — lightweight, non-invasive interceptors that capture observational
data during a live harvest run without modifying the source code under observation.

Both collectors are context managers; they install themselves on entry and restore
the original state on exit, making them safe to nest and compose.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from urllib.parse import urlparse

import requests


# ─── Data classes ─────────────────────────────────────────────────────────────

@dataclass
class CapturedLogRecord:
    """A single log event captured during the harvest run."""
    time: str
    level: str
    logger: str
    message: str
    exc_info: Optional[str] = None


@dataclass
class HttpCall:
    """One outbound HTTP request made during the harvest."""
    url: str
    server: str
    status: Optional[int]       # None = connection-level error (no response)
    elapsed_s: float
    size_bytes: int
    ok: bool
    redirected_to: Optional[str] = None
    error: Optional[str] = None  # populated when status is None


# ─── Log interceptor ──────────────────────────────────────────────────────────

class LogCapture(logging.Handler):
    """
    Installs on the root logger and captures every log record emitted during
    the harvest at DEBUG level and above.

    Thread-safe: the harvester runs multiple worker threads concurrently.
    """

    def __init__(self) -> None:
        super().__init__(logging.DEBUG)
        self.records: list[CapturedLogRecord] = []
        self._lock = threading.Lock()
        self.setFormatter(logging.Formatter("%(message)s"))

    def emit(self, record: logging.LogRecord) -> None:
        exc_text: Optional[str] = None
        if record.exc_info:
            exc_text = self.formatException(record.exc_info)
        entry = CapturedLogRecord(
            time=datetime.fromtimestamp(record.created).isoformat(timespec="seconds"),
            level=record.levelname,
            logger=record.name,
            message=record.getMessage(),
            exc_info=exc_text,
        )
        with self._lock:
            self.records.append(entry)

    def __enter__(self) -> "LogCapture":
        logging.getLogger().addHandler(self)
        return self

    def __exit__(self, *_) -> None:
        logging.getLogger().removeHandler(self)

    # ── Convenience filters ──────────────────────────────────────────────────

    def by_level(self, level: str) -> list[CapturedLogRecord]:
        return [r for r in self.records if r.level == level]

    @property
    def errors(self) -> list[CapturedLogRecord]:
        return [r for r in self.records if r.level in ("ERROR", "CRITICAL")]

    @property
    def warnings(self) -> list[CapturedLogRecord]:
        return [r for r in self.records if r.level == "WARNING"]

    def search(self, text: str) -> list[CapturedLogRecord]:
        """Case-insensitive substring search across all messages."""
        lower = text.lower()
        return [r for r in self.records if lower in r.message.lower()]

    def level_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for r in self.records:
            counts[r.level] = counts.get(r.level, 0) + 1
        return counts


# ─── HTTP call interceptor ─────────────────────────────────────────────────────

class HttpCallTracker:
    """
    Monkey-patches `requests.Session.get` to record the URL, HTTP status,
    elapsed time, response body size, and redirect target for every request
    the harvester makes to ERDDAP or CKAN servers.

    Thread-safe: uses a lock to protect the shared call list.
    """

    def __init__(self) -> None:
        self.calls: list[HttpCall] = []
        self._original_get = None
        self._lock = threading.Lock()

    # ── Context manager ───────────────────────────────────────────────────────

    def __enter__(self) -> "HttpCallTracker":
        self._original_get = requests.Session.get
        requests.Session.get = self._build_tracked_get(self._original_get)
        return self

    def __exit__(self, *_) -> None:
        if self._original_get is not None:
            requests.Session.get = self._original_get
            self._original_get = None

    # ── Internals ─────────────────────────────────────────────────────────────

    def _build_tracked_get(self, original):
        tracker = self

        def tracked_get(session_self, url: str, **kwargs):
            server = urlparse(url).netloc
            t0 = time.perf_counter()
            try:
                response = original(session_self, url, **kwargs)
                elapsed = time.perf_counter() - t0
                redirected_to: Optional[str] = None
                if response.url and response.url != url:
                    redirected_to = response.url
                call = HttpCall(
                    url=url,
                    server=server,
                    status=response.status_code,
                    elapsed_s=round(elapsed, 3),
                    size_bytes=len(response.content),
                    ok=response.status_code == 200,
                    redirected_to=redirected_to,
                )
            except Exception as exc:
                elapsed = time.perf_counter() - t0
                call = HttpCall(
                    url=url,
                    server=server,
                    status=None,
                    elapsed_s=round(elapsed, 3),
                    size_bytes=0,
                    ok=False,
                    error=str(exc),
                )
                with tracker._lock:
                    tracker.calls.append(call)
                raise

            with tracker._lock:
                tracker.calls.append(call)
            return response

        return tracked_get

    # ── Convenience filters ──────────────────────────────────────────────────

    @property
    def error_calls(self) -> list[HttpCall]:
        return [c for c in self.calls if not c.ok]

    @property
    def redirect_calls(self) -> list[HttpCall]:
        return [c for c in self.calls if c.redirected_to]

    def calls_for_server(self, server: str) -> list[HttpCall]:
        return [c for c in self.calls if c.server == server]

    def slowest(self, n: int = 10) -> list[HttpCall]:
        return sorted(self.calls, key=lambda c: c.elapsed_s, reverse=True)[:n]

    def largest(self, n: int = 10) -> list[HttpCall]:
        return sorted(self.calls, key=lambda c: c.size_bytes, reverse=True)[:n]

    def unique_servers(self) -> list[str]:
        return sorted({c.server for c in self.calls})
