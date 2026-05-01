"""
Populate cde.scientific_name_vernaculars from WoRMS.

For every distinct scientific name in cde.obis_scientific_names that is not yet
cached, look up the AphiaID via the WoRMS REST API and then fetch the taxon's
rank, full ancestor chain (for rank-aware filter rolldown), and vernacular
(common) names. English (eng) and French (fra) vernaculars are stored in
separate text[] columns so the API can serve the right one based on locale.

Name lookup is batched via AphiaRecordsByMatchNames (up to 50 names per call;
returns rank + valid_AphiaID inline). Vernacular and classification calls are
issued concurrently per chunk via a thread pool, since WoRMS has no batch
endpoint for either and serial round-trip latency is the real bottleneck
(each call ≈ 300 ms server-side). Classification fetches are deduped across
the run via an in-memory cache keyed on accepted AphiaID, so synonyms only
trigger one classification call between them.

Names are processed in descending order of OBIS record count, so an interrupted
run still leaves the most-impactful subset cached. Pass --top N to populate only
the top-N most-common species (useful for a quick triage backfill before the
long tail).

The script is idempotent and resumable: only names missing from the cache table
(or, with --refresh-status, names whose previous fetch failed) are processed.

Usage:
    python -m cde_db_loader.populate_vernaculars [--top N] [--limit N]
        [--workers N] [--rate R] [--batch-size N]
        [--refresh-status error,not_found]
"""
import argparse
import concurrent.futures
import logging
import os
import sys
import threading
import time
from typing import NamedTuple
from urllib.parse import urlencode

import requests
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from urllib3.util.retry import Retry

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)-8s - %(name)s : %(message)s",
)
logger = logging.getLogger("populate_vernaculars")

# Silence urllib3's generic "Retrying (Retry(total=3, …)) after connection
# broken by '…': /rest/…" warning — our LoggingRetry below emits a richer line
# with the full URL and remaining attempts, so leaving the default in would
# just duplicate every retry.
logging.getLogger("urllib3.connectionpool").setLevel(logging.ERROR)


class LoggingRetry(Retry):
    """urllib3.Retry that logs each retry with full URL and reason."""

    def increment(self, method=None, url=None, response=None, error=None,
                  _pool=None, _stacktrace=None):
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
            method or "GET", full_url, attempts_left, reason,
        )
        return super().increment(
            method=method, url=url, response=response,
            error=error, _pool=_pool, _stacktrace=_stacktrace,
        )

WORMS_BASE = "https://www.marinespecies.org/rest"

# WoRMS publishes no hard rate limit, only "considerate use" guidance. With
# --workers > 1 the per-call sleep is dropped — total throughput is bounded by
# response latency × worker count instead. The --rate flag still applies in
# single-worker mode and to the batch lookup call.
DEFAULT_RATE_PER_SEC = 20
DEFAULT_BATCH_SIZE = 50  # AphiaRecordsByMatchNames accepts up to 50 names per call.
DEFAULT_WORKERS = 8

# Status sentinels stored in fetch_status.
STATUS_OK = "ok"
STATUS_NOT_FOUND = "not_found"
STATUS_ERROR = "error"

# Sentinel accepted by --refresh-status to retarget rows that pre-date the
# rank/classification columns (or whose classification fetch errored out).
# Translated by names_to_process into a column-level condition rather than a
# fetch_status check, since the rows in question typically have status='ok'.
SENTINEL_MISSING_CLASSIFICATION = "missing_classification"


def build_engine(workers: int = DEFAULT_WORKERS):
    load_dotenv(os.path.join(os.getcwd(), ".env"))
    envs = os.environ
    db_host = envs.get("DB_HOST_EXTERNAL", "localhost")
    url = (
        f"postgresql://{envs['DB_USER']}:{envs['DB_PASSWORD']}@{db_host}:"
        f"{envs.get('DB_PORT', 5432)}/{envs['DB_NAME']}"
    )
    # Pool sized to the worker count so threads don't contend on connections.
    # We only ever take a connection inside the per-chunk transaction, so
    # `workers + 2` is plenty (one for the main thread + headroom).
    engine = create_engine(url, pool_size=workers + 2, max_overflow=4)
    engine.connect().close()
    logger.info("Connected to %s", db_host)
    return engine


def build_session(workers: int = DEFAULT_WORKERS):
    s = requests.Session()
    s.headers["User-Agent"] = "cioos-cde/populate_vernaculars (+https://cioos.ca)"
    s.headers["Accept"] = "application/json"
    # Auto-retry transient server-side issues: stale keep-alive disconnects
    # (RemoteDisconnected), 429 rate-limit pushes, and 5xx server errors.
    # Connection errors are retried by default; status_forcelist covers HTTP
    # responses that succeeded in reaching us but the server signalled retry.
    retry = LoggingRetry(
        total=4,
        connect=4,
        read=4,
        backoff_factor=0.5,           # 0.5s, 1s, 2s, 4s between attempts
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=frozenset(["GET"]),
        raise_on_status=False,
        respect_retry_after_header=True,
    )
    # Connection pool sized to the worker count to avoid the urllib3
    # "Connection pool is full, discarding connection" churn that thrashes
    # WoRMS with TLS reconnects when --workers exceeds the default.
    adapter = requests.adapters.HTTPAdapter(
        pool_connections=workers + 2,
        pool_maxsize=workers + 2,
        max_retries=retry,
    )
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    return s


def match_aphia_ids(session: requests.Session, names: list[str]):
    """Batch-resolve scientific names to (AphiaID, rank) pairs.

    Returns a list parallel to ``names``: each entry is ``(aphia_id, rank)`` where
    ``aphia_id`` prefers ``valid_AphiaID`` (the accepted-name id for synonyms) and
    ``rank`` is the WoRMS rank string (e.g. ``"Genus"``). Both fields are ``None``
    when WoRMS had no match. Raises requests.RequestException on transport / HTTP
    errors so the caller can fall back to per-name handling.
    """
    if not names:
        return []
    # PHP-style array params: scientificnames[]=Name1&scientificnames[]=Name2...
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
        # Prefer valid_AphiaID (the accepted-name id) since vernaculars hang off
        # accepted names; fall back to AphiaID if valid is missing.
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
    """Return (vernaculars_en, vernaculars_fr) preserving WoRMS order."""
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
    """Return the strict-ancestor AphiaID list for a taxon, root-first.

    WoRMS returns a nested chain (Superdomain → ... → queried taxon) where each
    node has ``AphiaID``, ``rank``, ``scientificname``, and a single ``child``.
    The leaf has ``child: null`` and is the queried taxon — its AphiaID is the
    one we passed in, so we exclude it. Everything above is an ancestor used by
    the rolldown filter.
    """
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
        # Strict ancestor: only count nodes that have a child below them.
        if child is not None and isinstance(aid, int) and aid > 0:
            ancestors.append(aid)
        node = child
    return ancestors


class ClassificationCache:
    """Run-wide cache so multiple synonyms with the same accepted AphiaID
    only trigger one /AphiaClassificationByAphiaID call between them."""

    def __init__(self):
        self._cache: dict[int, list[int]] = {}
        self._lock = threading.Lock()

    def get(self, aphia_id: int):
        with self._lock:
            return self._cache.get(aphia_id)

    def put(self, aphia_id: int, ancestors: list[int]):
        with self._lock:
            self._cache[aphia_id] = ancestors


class TaxonResult(NamedTuple):
    name: str
    aphia_id: int | None
    rank: str | None
    ancestors: list[int]
    vernaculars_en: list[str]
    vernaculars_fr: list[str]
    status: str


UPSERT_SQL = text(
    """
    INSERT INTO cde.scientific_name_vernaculars
        (scientific_name, aphia_id, rank, ancestor_aphia_ids,
         vernaculars_en, vernaculars_fr, fetched_at, fetch_status)
    VALUES (:name, :aphia_id, :rank, :ancestors, :en, :fr, now(), :status)
    ON CONFLICT (scientific_name) DO UPDATE SET
        aphia_id           = EXCLUDED.aphia_id,
        rank               = EXCLUDED.rank,
        ancestor_aphia_ids = EXCLUDED.ancestor_aphia_ids,
        vernaculars_en     = EXCLUDED.vernaculars_en,
        vernaculars_fr     = EXCLUDED.vernaculars_fr,
        fetched_at         = EXCLUDED.fetched_at,
        fetch_status       = EXCLUDED.fetch_status
    """
)


def names_to_process(conn, refresh_statuses, top_n=None):
    """Return scientific_names to process, ordered by OBIS record popularity.

    Names with the most observations come first so an interrupted run still
    leaves the most-impactful subset cached. ``top_n`` caps the result list.
    """
    # Two refresh axes can apply at once: explicit fetch_status values (e.g.
    # 'error', 'not_found') and the missing_classification sentinel that targets
    # rows populated before the rank/classification columns existed.
    refresh_clauses = []
    params = {}
    statuses = set(refresh_statuses)
    if SENTINEL_MISSING_CLASSIFICATION in statuses:
        statuses.discard(SENTINEL_MISSING_CLASSIFICATION)
        # status='ok' rows that have an aphia_id but no ancestors: pre-existing
        # rows from the vernacular-only era, or rows whose classification fetch
        # errored (we keep those at status='ok' since vernaculars succeeded).
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

    # Popularity is precomputed in cde.obis_scientific_name_popularity (a
    # materialized view refreshed by 5_profile_process.sql after each harvest).
    # Recomputing it inline here was a multi-minute unnest+GROUP BY over the
    # whole obis_cells table — fine for a 6-hour backfill, but disastrous for
    # short --top N runs that pay the bootstrap cost without amortising it.
    sql = text(
        f"""
        SELECT n.scientific_name
          FROM cde.obis_scientific_names n
     LEFT JOIN cde.scientific_name_vernaculars v
            ON v.scientific_name = n.scientific_name
     LEFT JOIN cde.obis_scientific_name_popularity p
            ON p.scientific_name = n.scientific_name
         WHERE v.scientific_name IS NULL
            {refresh_clause}
      ORDER BY COALESCE(p.total_records, 0) DESC, n.scientific_name
        {limit_clause}
        """
    )
    return [row[0] for row in conn.execute(sql, params)]


def _fetch_taxon_data(session, name, aid, rank, classification_cache):
    """Worker: fetch vernaculars + (cached) classification for one (name, AphiaID).

    Classification fetches are deduped across the run via ``classification_cache``;
    a name whose accepted AphiaID was already seen reuses the cached ancestor list.
    Classification failures are non-fatal — vernaculars still land and the row is
    marked ok with an empty ancestor list, which a later
    ``--refresh-status missing_classification`` pass can fill in.
    """
    try:
        en, fr = fetch_vernaculars(session, aid)
    except requests.RequestException as exc:
        logger.warning("AphiaVernacularsByAphiaID failed for %r (%s): %s", name, aid, exc)
        return TaxonResult(name, aid, rank, [], [], [], STATUS_ERROR)

    cached = classification_cache.get(aid)
    if cached is not None:
        return TaxonResult(name, aid, rank, cached, en, fr, STATUS_OK)

    try:
        ancestors = fetch_classification(session, aid)
    except requests.RequestException as exc:
        logger.warning("AphiaClassificationByAphiaID failed for %r (%s): %s", name, aid, exc)
        ancestors = []
    classification_cache.put(aid, ancestors)
    return TaxonResult(name, aid, rank, ancestors, en, fr, STATUS_OK)


def process_chunk(session, engine, executor, names, sleep_seconds, counts,
                  classification_cache):
    """Resolve a chunk of names and persist results.

    All upserts for the chunk are committed in a single transaction.
    """
    try:
        matches = match_aphia_ids(session, names)
    except requests.RequestException as exc:
        logger.warning("Batch AphiaRecordsByMatchNames failed (%d names): %s", len(names), exc)
        with engine.begin() as conn:
            for name in names:
                conn.execute(
                    UPSERT_SQL,
                    {"name": name, "aphia_id": None, "rank": None, "ancestors": [],
                     "en": [], "fr": [], "status": STATUS_ERROR},
                )
        counts[STATUS_ERROR] += len(names)
        time.sleep(sleep_seconds)
        return
    time.sleep(sleep_seconds)

    # Split into immediate misses (no AphiaID) and pending taxon-data fetches.
    results: list[TaxonResult] = []
    pending = []
    for name, (aid, rank) in zip(names, matches):
        if aid is None:
            results.append(TaxonResult(name, None, None, [], [], [], STATUS_NOT_FOUND))
        else:
            pending.append((name, aid, rank))

    if executor is not None:
        futures = [
            executor.submit(_fetch_taxon_data, session, name, aid, rank, classification_cache)
            for name, aid, rank in pending
        ]
        for fut in concurrent.futures.as_completed(futures):
            results.append(fut.result())
    else:
        # Serial path: keep the per-call throttle.
        for name, aid, rank in pending:
            results.append(_fetch_taxon_data(session, name, aid, rank, classification_cache))
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

    with engine.connect() as conn:
        todo = names_to_process(conn, refresh, top_n=args.top)
    if args.limit is not None:
        todo = todo[: args.limit]

    total = len(todo)
    logger.info(
        "Names to process: %d (refresh=%s, top=%s, batch=%d, workers=%d, rate=%.1f/s)",
        total, sorted(refresh) or "none",
        args.top if args.top is not None else "all",
        batch_size, workers, args.rate,
    )

    counts = {STATUS_OK: 0, STATUS_NOT_FOUND: 0, STATUS_ERROR: 0}
    processed = 0

    classification_cache = ClassificationCache()
    executor = (
        concurrent.futures.ThreadPoolExecutor(max_workers=workers)
        if workers > 1 else None
    )
    try:
        for start in range(0, total, batch_size):
            chunk = todo[start : start + batch_size]
            process_chunk(session, engine, executor, chunk, sleep_seconds, counts,
                          classification_cache)
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


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logger.info("Interrupted")
        sys.exit(130)
    except Exception:
        logger.exception("populate_vernaculars failed")
        sys.exit(1)
