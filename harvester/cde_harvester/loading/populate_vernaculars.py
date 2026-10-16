"""
Populate cde.scientific_name_vernaculars from WoRMS.

For every uncached scientific name in cde.obis_scientific_names, look up the
AphiaID, rank, ancestor chain, WoRMS functional groups (for the biology EOVs, see
obis_derive_eovs()) and English/French vernaculars via the WoRMS REST API. Names
are processed most-recorded first, so an interrupted run still caches the
most-impactful subset. Idempotent and resumable: resolved names whose functional
groups were never fetched are picked up too.

Usage:
    python -m cde_harvester.loading.populate_vernaculars [--top N] [--limit N]
        [--workers N] [--rate R] [--batch-size N]
        [--refresh-status error,not_found]
"""

import argparse
import concurrent.futures
import logging
import sys
import threading
import time
from typing import NamedTuple
from urllib.parse import urlencode

import requests
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from urllib3.util.retry import Retry

from cde_harvester.core.db import create_db_engine, db_host

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)-8s - %(name)s : %(message)s",
)
logger = logging.getLogger("populate_vernaculars")

# LoggingRetry logs a richer line for every retry urllib3 would warn about.
logging.getLogger("urllib3.connectionpool").setLevel(logging.ERROR)


class LoggingRetry(Retry):
    def increment(
        self,
        method=None,
        url=None,
        response=None,
        error=None,
        _pool=None,
        _stacktrace=None,
    ):
        full_url = url or ""
        if _pool is not None and url:
            full_url = f"{_pool.scheme}://{_pool.host}{url}"
        if error is not None:
            reason = f"{type(error).__name__}: {error}"
        elif response is not None:
            reason = f"HTTP {response.status}"
        else:
            reason = "unknown"
        attempts_left = self.total - 1 if isinstance(self.total, int) else "?"
        logger.info(
            "Retrying %s %s (attempts left=%s) after %s",
            method or "GET",
            full_url,
            attempts_left,
            reason,
        )
        return super().increment(
            method=method,
            url=url,
            response=response,
            error=error,
            _pool=_pool,
            _stacktrace=_stacktrace,
        )


WORMS_BASE = "https://www.marinespecies.org/rest"

# WoRMS publishes no hard rate limit, only "considerate use" guidance.
DEFAULT_RATE_PER_SEC = 20
DEFAULT_BATCH_SIZE = 50  # AphiaRecordsByMatchNames accepts up to 50 names per call.
DEFAULT_WORKERS = 8

STATUS_OK = "ok"
STATUS_NOT_FOUND = "not_found"
STATUS_ERROR = "error"

# --refresh-status sentinel; matched on columns, not fetch_status, since
# those rows have status='ok'.
SENTINEL_MISSING_CLASSIFICATION = "missing_classification"


def build_engine(workers: int = DEFAULT_WORKERS):
    engine = create_db_engine(pool_size=workers + 2, max_overflow=4)
    engine.connect().close()
    logger.info("Connected to %s", db_host())
    return engine


def build_session(workers: int = DEFAULT_WORKERS):
    s = requests.Session()
    s.headers["User-Agent"] = "cioos-cde/populate_vernaculars (+https://cioos.ca)"
    s.headers["Accept"] = "application/json"
    retry = LoggingRetry(
        total=4,
        connect=4,
        read=4,
        backoff_factor=0.5,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=frozenset(["GET"]),
        raise_on_status=False,
        respect_retry_after_header=True,
    )
    # A pool smaller than the worker count thrashes WoRMS with TLS reconnects.
    adapter = requests.adapters.HTTPAdapter(
        pool_connections=workers + 2,
        pool_maxsize=workers + 2,
        max_retries=retry,
    )
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    return s


def match_aphia_ids(session: requests.Session, names: list[str]):
    """List parallel to ``names`` of ``(aphia_id, rank)``, ``(None, None)`` when
    unmatched."""
    if not names:
        return []
    params = [("scientificnames[]", n) for n in names] + [("marine_only", "false")]
    url = f"{WORMS_BASE}/AphiaRecordsByMatchNames?{urlencode(params)}"
    r = session.get(url, timeout=60)
    if r.status_code == 204 or not r.text.strip():
        return [(None, None)] * len(names)
    r.raise_for_status()
    body = r.json() or []
    out = []
    for matches in body:
        if not matches:
            out.append((None, None))
            continue
        first = matches[0]
        # Vernaculars hang off accepted names.
        aid = first.get("valid_AphiaID") or first.get("AphiaID")
        rank = first.get("rank")
        if not (isinstance(aid, int) and aid > 0):
            out.append((None, None))
        else:
            out.append((aid, rank if isinstance(rank, str) and rank else None))
    while len(out) < len(names):
        out.append((None, None))
    return out[: len(names)]


def fetch_vernaculars(session: requests.Session, aphia_id: int):
    url = f"{WORMS_BASE}/AphiaVernacularsByAphiaID/{aphia_id}"
    r = session.get(url, timeout=15)
    if r.status_code == 204 or not r.text.strip():
        return [], []
    r.raise_for_status()
    items = r.json() or []
    en, fr = [], []
    for v in items:
        text_val = (v.get("vernacular") or "").strip()
        if not text_val:
            continue
        code = (v.get("language_code") or "").lower()
        if code == "eng":
            en.append(text_val)
        elif code == "fra":
            fr.append(text_val)
    en = list(dict.fromkeys(en))
    fr = list(dict.fromkeys(fr))
    return en, fr


def fetch_classification(session: requests.Session, aphia_id: int):
    """Strict-ancestor AphiaIDs, root-first; the leaf (``child: null``) is the
    queried taxon itself."""
    url = f"{WORMS_BASE}/AphiaClassificationByAphiaID/{aphia_id}"
    r = session.get(url, timeout=15)
    if r.status_code == 204 or not r.text.strip():
        return []
    r.raise_for_status()
    body = r.json()
    if not body:
        return []
    ancestors = []
    node = body
    while isinstance(node, dict):
        child = node.get("child")
        aid = node.get("AphiaID")
        if child is not None and isinstance(aid, int) and aid > 0:
            ancestors.append(aid)
        node = child
    return ancestors


def fetch_functional_groups(session: requests.Session, aphia_id: int):
    """Only adult-stage (or stage-less) groups count: a scallop's larva is
    zooplankton, but a scallop survey is not."""
    url = f"{WORMS_BASE}/AphiaAttributesByAphiaID/{aphia_id}"
    r = session.get(url, params={"include_inherited": "true"}, timeout=15)
    if r.status_code == 204 or not r.text.strip():
        return []
    r.raise_for_status()
    groups = []
    for attribute in r.json() or []:
        if attribute.get("measurementType") != "Functional group":
            continue
        stages = [
            child.get("measurementValue")
            for child in attribute.get("children") or []
            if child.get("measurementType") == "Life stage"
        ]
        if not stages or "adult" in stages:
            groups.append(attribute.get("measurementValue"))
    return sorted({g for g in groups if g})


class TaxonCache:
    """Synonyms share an accepted AphiaID, so fetch its classification and
    functional groups once."""

    def __init__(self):
        self._cache: dict[int, tuple[list[int], list[str] | None]] = {}
        self._lock = threading.Lock()

    def get(self, aphia_id: int):
        with self._lock:
            return self._cache.get(aphia_id)

    def put(self, aphia_id: int, ancestors: list[int], functional_groups):
        with self._lock:
            self._cache[aphia_id] = (ancestors, functional_groups)


class TaxonResult(NamedTuple):
    name: str
    aphia_id: int | None
    rank: str | None
    ancestors: list[int]
    vernaculars_en: list[str]
    vernaculars_fr: list[str]
    status: str
    # None = the fetch failed, so the row is picked up again by the next run.
    functional_groups: list[str] | None = None


UPSERT_SQL = text(
    """
    INSERT INTO cde.scientific_name_vernaculars
        (scientific_name, aphia_id, rank, ancestor_aphia_ids, functional_groups,
         vernaculars_en, vernaculars_fr, fetched_at, fetch_status)
    VALUES (:name, :aphia_id, :rank, :ancestors, :functional_groups,
            :en, :fr, now(), :status)
    ON CONFLICT (scientific_name) DO UPDATE SET
        aphia_id           = EXCLUDED.aphia_id,
        rank               = EXCLUDED.rank,
        ancestor_aphia_ids = EXCLUDED.ancestor_aphia_ids,
        functional_groups  = EXCLUDED.functional_groups,
        vernaculars_en     = EXCLUDED.vernaculars_en,
        vernaculars_fr     = EXCLUDED.vernaculars_fr,
        fetched_at         = EXCLUDED.fetched_at,
        fetch_status       = EXCLUDED.fetch_status
    """
)


def refresh_popularity(engine):
    """This script is the view's only reader, so it is refreshed here rather
    than on the load path. A failure only makes the ordering stale."""
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "REFRESH MATERIALIZED VIEW CONCURRENTLY "
                    "cde.obis_scientific_name_popularity"
                )
            )
        logger.info("Refreshed cde.obis_scientific_name_popularity")
    except SQLAlchemyError as exc:
        logger.warning(
            "Could not refresh cde.obis_scientific_name_popularity (%s); "
            "ordering by a possibly stale popularity",
            exc,
        )


def names_to_process(conn, refresh_statuses, top_n=None):
    refresh_clauses = []
    params = {}
    statuses = set(refresh_statuses)
    if SENTINEL_MISSING_CLASSIFICATION in statuses:
        statuses.discard(SENTINEL_MISSING_CLASSIFICATION)
        # A failed classification fetch keeps status='ok' (vernaculars landed).
        refresh_clauses.append(
            "(v.fetch_status = '" + STATUS_OK + "' "
            "AND v.aphia_id IS NOT NULL "
            "AND coalesce(array_length(v.ancestor_aphia_ids, 1), 0) = 0)"
        )
    if statuses:
        refresh_clauses.append("v.fetch_status = ANY(:refresh)")
        params["refresh"] = list(statuses)
    refresh_clause = ""
    if refresh_clauses:
        refresh_clause = "OR (" + " OR ".join(refresh_clauses) + ")"

    limit_clause = ""
    if top_n is not None:
        limit_clause = "LIMIT :top_n"
        params["top_n"] = top_n

    # Precomputed: inline it is a multi-minute unnest+GROUP BY over obis_cells.
    sql = text(
        f"""
        SELECT n.scientific_name
          FROM cde.obis_scientific_names n
     LEFT JOIN cde.scientific_name_vernaculars v
            ON v.scientific_name = n.scientific_name
     LEFT JOIN cde.obis_scientific_name_popularity p
            ON p.scientific_name = n.scientific_name
         WHERE v.scientific_name IS NULL
            -- Resolved before functional groups were fetched, or that fetch
            -- failed: without them the plankton/invertebrate EOVs can't match.
            OR (v.aphia_id IS NOT NULL AND v.functional_groups IS NULL)
            {refresh_clause}
      ORDER BY COALESCE(p.total_records, 0) DESC, n.scientific_name
        {limit_clause}
        """
    )
    return [row[0] for row in conn.execute(sql, params)]


def _fetch_taxon_data(session, name, aid, rank, taxon_cache):
    """A classification failure still marks the row ok with no ancestors, for a
    later ``--refresh-status missing_classification`` pass."""
    try:
        en, fr = fetch_vernaculars(session, aid)
    except requests.RequestException as exc:
        logger.warning(
            "AphiaVernacularsByAphiaID failed for %r (%s): %s", name, aid, exc
        )
        return TaxonResult(name, aid, rank, [], [], [], STATUS_ERROR)

    cached = taxon_cache.get(aid)
    if cached is not None:
        ancestors, functional_groups = cached
        return TaxonResult(
            name, aid, rank, ancestors, en, fr, STATUS_OK, functional_groups
        )

    try:
        ancestors = fetch_classification(session, aid)
    except requests.RequestException as exc:
        logger.warning(
            "AphiaClassificationByAphiaID failed for %r (%s): %s", name, aid, exc
        )
        ancestors = []
    try:
        functional_groups = fetch_functional_groups(session, aid)
    except requests.RequestException as exc:
        logger.warning(
            "AphiaAttributesByAphiaID failed for %r (%s): %s", name, aid, exc
        )
        functional_groups = None
    taxon_cache.put(aid, ancestors, functional_groups)
    return TaxonResult(
        name, aid, rank, ancestors, en, fr, STATUS_OK, functional_groups
    )


def process_chunk(
    session, engine, executor, names, sleep_seconds, counts, taxon_cache
):
    try:
        matches = match_aphia_ids(session, names)
    except requests.RequestException as exc:
        logger.warning(
            "Batch AphiaRecordsByMatchNames failed (%d names): %s", len(names), exc
        )
        with engine.begin() as conn:
            for name in names:
                conn.execute(
                    UPSERT_SQL,
                    {
                        "name": name,
                        "aphia_id": None,
                        "rank": None,
                        "ancestors": [],
                        "functional_groups": None,
                        "en": [],
                        "fr": [],
                        "status": STATUS_ERROR,
                    },
                )
        counts[STATUS_ERROR] += len(names)
        time.sleep(sleep_seconds)
        return
    time.sleep(sleep_seconds)

    results: list[TaxonResult] = []
    pending = []
    for name, (aid, rank) in zip(names, matches, strict=True):
        if aid is None:
            results.append(TaxonResult(name, None, None, [], [], [], STATUS_NOT_FOUND))
        else:
            pending.append((name, aid, rank))

    if executor is not None:
        futures = [
            executor.submit(
                _fetch_taxon_data, session, name, aid, rank, taxon_cache
            )
            for name, aid, rank in pending
        ]
        for fut in concurrent.futures.as_completed(futures):
            results.append(fut.result())
    else:
        for name, aid, rank in pending:
            results.append(
                _fetch_taxon_data(session, name, aid, rank, taxon_cache)
            )
            time.sleep(sleep_seconds)

    with engine.begin() as conn:
        for r in results:
            conn.execute(
                UPSERT_SQL,
                {
                    "name": r.name,
                    "aphia_id": r.aphia_id,
                    "rank": r.rank,
                    "ancestors": r.ancestors,
                    "functional_groups": r.functional_groups,
                    "en": r.vernaculars_en,
                    "fr": r.vernaculars_fr,
                    "status": r.status,
                },
            )
            counts[r.status] += 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--top",
        type=int,
        default=None,
        help="Process only the N most-common species (by total OBIS records). "
        "Defaults to all uncached names. Useful for a fast triage backfill.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Process at most this many names this run, after --top is applied "
        "(useful for smoke tests).",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=DEFAULT_WORKERS,
        help="Concurrent vernacular fetches per chunk (default: %(default)s). "
        "Set to 1 to disable concurrency and re-enable per-call throttling.",
    )
    parser.add_argument(
        "--rate",
        type=float,
        default=DEFAULT_RATE_PER_SEC,
        help="Approximate WoRMS HTTP requests per second when concurrency is "
        "off, and the throttle on the batch lookup call when on "
        "(default: %(default)s).",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help="Names per AphiaRecordsByMatchNames call (max 50; default: %(default)s).",
    )
    parser.add_argument(
        "--refresh-status",
        default="",
        help="Comma-separated list of fetch_status values to retry "
        "(e.g. 'error,not_found'). Also accepts the sentinel "
        "'missing_classification' to refill rank/ancestor data for rows "
        "that were populated before those columns existed. "
        "Empty = skip already-cached rows.",
    )
    args = parser.parse_args()

    refresh = {s.strip() for s in args.refresh_status.split(",") if s.strip()}
    sleep_seconds = 1.0 / max(args.rate, 0.1)
    batch_size = max(1, min(args.batch_size, 50))
    workers = max(1, args.workers)

    engine = build_engine(workers)
    session = build_session(workers)

    refresh_popularity(engine)
    with engine.connect() as conn:
        todo = names_to_process(conn, refresh, top_n=args.top)
    if args.limit is not None:
        todo = todo[: args.limit]

    total = len(todo)
    logger.info(
        "Names to process: %d (refresh=%s, top=%s, batch=%d, workers=%d, rate=%.1f/s)",
        total,
        sorted(refresh) or "none",
        args.top if args.top is not None else "all",
        batch_size,
        workers,
        args.rate,
    )

    counts = {STATUS_OK: 0, STATUS_NOT_FOUND: 0, STATUS_ERROR: 0}
    processed = 0

    taxon_cache = TaxonCache()
    executor = (
        concurrent.futures.ThreadPoolExecutor(max_workers=workers)
        if workers > 1
        else None
    )
    try:
        for start in range(0, total, batch_size):
            chunk = todo[start : start + batch_size]
            process_chunk(
                session,
                engine,
                executor,
                chunk,
                sleep_seconds,
                counts,
                taxon_cache,
            )
            processed += len(chunk)
            if processed % (batch_size * 5) == 0 or processed == total:
                logger.info(
                    "Progress: %d / %d (ok=%d not_found=%d error=%d)",
                    processed,
                    total,
                    counts[STATUS_OK],
                    counts[STATUS_NOT_FOUND],
                    counts[STATUS_ERROR],
                )
    finally:
        if executor is not None:
            executor.shutdown(wait=True)

    logger.info(
        "Done. ok=%d not_found=%d error=%d",
        counts[STATUS_OK],
        counts[STATUS_NOT_FOUND],
        counts[STATUS_ERROR],
    )

    # So the Scientific Name filter works without waiting for the next load.
    logger.info("Backfilling obis_cells.aphia_ids from vernaculars")
    with engine.begin() as conn:
        backfilled = conn.execute(text("SELECT obis_backfill_aphia_ids()")).scalar()
        derived = conn.execute(text("SELECT obis_derive_eovs()")).scalar()
    logger.info("Backfilled aphia_ids into %s obis_cells", backfilled)
    logger.info("Re-derived EOVs on %s obis_cells", derived)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logger.info("Interrupted")
        sys.exit(130)
    except Exception:
        logger.exception("populate_vernaculars failed")
        sys.exit(1)
