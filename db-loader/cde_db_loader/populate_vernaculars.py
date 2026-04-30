"""
Populate cde.scientific_name_vernaculars from WoRMS.

For every distinct scientific name in cde.obis_scientific_names that is not yet
cached, look up the AphiaID via the WoRMS REST API and then fetch all vernacular
(common) names. We store English (eng) and French (fra) vernaculars in separate
text[] columns so the API can serve the right one based on the user's locale.

Name lookup is batched via AphiaRecordsByMatchNames (up to 50 names per call).
Vernacular calls are issued concurrently per chunk via a thread pool, since
WoRMS has no batch vernacular endpoint and serial round-trip latency is the
real bottleneck (each call ≈ 300 ms server-side).

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
import time
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
    """Batch-resolve scientific names to AphiaIDs.

    Returns a list parallel to ``names``: each entry is an int AphiaID (preferring
    valid_AphiaID, the accepted-name id for synonyms), or None if WoRMS had no
    match. Raises requests.RequestException on transport / HTTP errors so the
    caller can fall back to per-name handling.
    """
    if not names:
        return []
    # PHP-style array params: scientificnames[]=Name1&scientificnames[]=Name2...
    params = [("scientificnames[]", n) for n in names] + [("marine_only", "false")]
    url = f"{WORMS_BASE}/AphiaRecordsByMatchNames?{urlencode(params)}"
    r = session.get(url, timeout=60)
    if r.status_code == 204 or not r.text.strip():
        return [None] * len(names)
    r.raise_for_status()
    body = r.json() or []
    out = []
    for matches in body:
        if not matches:
            out.append(None)
            continue
        first = matches[0]
        # Prefer valid_AphiaID (the accepted-name id) since vernaculars hang off
        # accepted names; fall back to AphiaID if valid is missing.
        aid = first.get("valid_AphiaID") or first.get("AphiaID")
        out.append(aid if isinstance(aid, int) and aid > 0 else None)
    while len(out) < len(names):
        out.append(None)
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


UPSERT_SQL = text(
    """
    INSERT INTO cde.scientific_name_vernaculars
        (scientific_name, aphia_id, vernaculars_en, vernaculars_fr,
         fetched_at, fetch_status)
    VALUES (:name, :aphia_id, :en, :fr, now(), :status)
    ON CONFLICT (scientific_name) DO UPDATE SET
        aphia_id       = EXCLUDED.aphia_id,
        vernaculars_en = EXCLUDED.vernaculars_en,
        vernaculars_fr = EXCLUDED.vernaculars_fr,
        fetched_at     = EXCLUDED.fetched_at,
        fetch_status   = EXCLUDED.fetch_status
    """
)


def names_to_process(conn, refresh_statuses, top_n=None):
    """Return scientific_names to process, ordered by OBIS record popularity.

    Names with the most observations come first so an interrupted run still
    leaves the most-impactful subset cached. ``top_n`` caps the result list.
    """
    refresh_clause = ""
    params = {}
    if refresh_statuses:
        refresh_clause = "OR v.fetch_status = ANY(:refresh)"
        params["refresh"] = list(refresh_statuses)

    limit_clause = ""
    if top_n is not None:
        limit_clause = "LIMIT :top_n"
        params["top_n"] = top_n

    sql = text(
        f"""
        WITH popularity AS (
            SELECT sn AS scientific_name,
                   SUM(c.n_records) AS total_records
              FROM cde.obis_cells c,
                   unnest(c.scientific_names) AS t(sn)
             GROUP BY sn
        )
        SELECT n.scientific_name
          FROM cde.obis_scientific_names n
     LEFT JOIN cde.scientific_name_vernaculars v
            ON v.scientific_name = n.scientific_name
     LEFT JOIN popularity p
            ON p.scientific_name = n.scientific_name
         WHERE v.scientific_name IS NULL
            {refresh_clause}
      ORDER BY COALESCE(p.total_records, 0) DESC, n.scientific_name
        {limit_clause}
        """
    )
    return [row[0] for row in conn.execute(sql, params)]


def _vernacular_or_error(session, name, aid):
    """Wrapper for the thread pool: returns (name, aid, en, fr, status)."""
    try:
        en, fr = fetch_vernaculars(session, aid)
        return (name, aid, en, fr, STATUS_OK)
    except requests.RequestException as exc:
        logger.warning("AphiaVernacularsByAphiaID failed for %r (%s): %s", name, aid, exc)
        return (name, aid, [], [], STATUS_ERROR)


def process_chunk(session, engine, executor, names, sleep_seconds, counts):
    """Resolve a chunk of names and persist results.

    All upserts for the chunk are committed in a single transaction.
    """
    try:
        aphia_ids = match_aphia_ids(session, names)
    except requests.RequestException as exc:
        logger.warning("Batch AphiaRecordsByMatchNames failed (%d names): %s", len(names), exc)
        with engine.begin() as conn:
            for name in names:
                conn.execute(
                    UPSERT_SQL,
                    {"name": name, "aphia_id": None, "en": [], "fr": [], "status": STATUS_ERROR},
                )
        counts[STATUS_ERROR] += len(names)
        time.sleep(sleep_seconds)
        return
    time.sleep(sleep_seconds)

    # Split into immediate misses (no AphiaID) and pending vernacular fetches.
    results = []
    pending = []
    for name, aid in zip(names, aphia_ids):
        if aid is None:
            results.append((name, None, [], [], STATUS_NOT_FOUND))
        else:
            pending.append((name, aid))

    if executor is not None:
        # Concurrent vernacular fetches.
        futures = [executor.submit(_vernacular_or_error, session, name, aid)
                   for name, aid in pending]
        for fut in concurrent.futures.as_completed(futures):
            results.append(fut.result())
    else:
        # Serial path: keep the per-call throttle.
        for name, aid in pending:
            results.append(_vernacular_or_error(session, name, aid))
            time.sleep(sleep_seconds)

    with engine.begin() as conn:
        for name, aid, en, fr, status in results:
            conn.execute(
                UPSERT_SQL,
                {"name": name, "aphia_id": aid, "en": en, "fr": fr, "status": status},
            )
            counts[status] += 1


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
             "(e.g. 'error,not_found'). Empty = skip already-cached rows.",
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

    executor = (
        concurrent.futures.ThreadPoolExecutor(max_workers=workers)
        if workers > 1 else None
    )
    try:
        for start in range(0, total, batch_size):
            chunk = todo[start : start + batch_size]
            process_chunk(session, engine, executor, chunk, sleep_seconds, counts)
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
