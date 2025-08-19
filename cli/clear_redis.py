#!/usr/bin/env python3
"""
Clear only Explorer/web-api cache keys from Redis, using SCAN + UNLINK (or DEL).

Usage examples:
  # Dry-run: show how many keys match the default prefix
  python scripts/clear_explorer_cache.py --prefix web-api: --dry-run

  # Actually delete matching keys
  python scripts/clear_explorer_cache.py --prefix web-api:

  # Use a custom pattern (takes precedence over prefix)
  python scripts/clear_explorer_cache.py --pattern "cde:cache:*"

  # Connect via URL (falls back to env vars if not provided)
  REDIS_URL=redis://localhost:6379/0 python scripts/clear_explorer_cache.py --prefix web-api:
"""
from __future__ import annotations

import argparse
import os
import sys
from typing import Iterable, List, Tuple

try:
    import redis  # redis-py
except ImportError as e:
    print("Missing dependency. Install with:  pip install 'redis>=5.0'", file=sys.stderr)
    raise

DEFAULT_SCAN_COUNT = 1000
DEFAULT_BATCH_SIZE = 1000


def chunked(iterable: Iterable[str], size: int) -> Iterable[List[str]]:
    batch: List[str] = []
    for item in iterable:
        batch.append(item)
        if len(batch) >= size:
            yield batch
            batch = []
    if batch:
        yield batch


def make_client_from_env_or_args(args: argparse.Namespace) -> redis.Redis:
    """
    Build a redis client from:
      1) --url if provided
      2) REDIS_URL env var
      3) host/port/password/db (args or env)
    """
    url = args.url or os.getenv("REDIS_URL")
    if url:
        return redis.from_url(url, decode_responses=True)

    host = args.host or os.getenv("REDIS_HOST", "localhost")
    port = int(args.port or os.getenv("REDIS_PORT", "6379"))
    db = int(args.db or os.getenv("REDIS_DB", "0"))
    password = args.password or os.getenv("REDIS_PASSWORD")
    return redis.Redis(host=host, port=port, db=db, password=password, decode_responses=True)


def unlink_supported(r: redis.Redis) -> bool:
    """
    Check whether UNLINK is supported by this server.
    We try a COMMAND DOCS lookup first (Redis 7+), fall back to a small runtime probe.
    """
    try:
        # Best effort: ask server for docs of UNLINK (available Redis 7+)
        # If this fails, we'll fall back to trying UNLINK on a non-existent key.
        r.execute_command("COMMAND", "DOCS", "UNLINK")
        return True
    except Exception:
        try:
            # Probe UNLINK; on old servers this may error with "unknown command"
            r.unlink("__nonexistent_key_probe__")
            return True
        except Exception:
            return False


def scan_keys(r: redis.Redis, pattern: str, count: int) -> Iterable[str]:
    cursor = 0
    while True:
        cursor, keys = r.scan(cursor=cursor, match=pattern, count=count)
        for k in keys:
            yield k
        if cursor == 0:
            break


def delete_keys(r: redis.Redis, keys_iter: Iterable[str], use_unlink: bool, batch_size: int) -> Tuple[int, int]:
    """
    Delete keys in batches. Returns (deleted_count, batches).
    """
    total_deleted = 0
    batches = 0

    if use_unlink:
        # Use non-blocking UNLINK in batches
        for batch in chunked(keys_iter, batch_size):
            try:
                # redis-py returns an int for number of keys unlinked
                deleted = r.unlink(*batch)
            except Exception:
                # If UNLINK isn't supported after all, fall back to DEL
                pipe = r.pipeline()
                for k in batch:
                    pipe.delete(k)
                deleted_list = pipe.execute()
                deleted = sum(int(x) for x in deleted_list)
                use_unlink = False  # Stop trying UNLINK further
            total_deleted += int(deleted)
            batches += 1
    else:
        # Fallback: DEL via pipeline
        for batch in chunked(keys_iter, batch_size):
            pipe = r.pipeline()
            for k in batch:
                pipe.delete(k)
            deleted_list = pipe.execute()
            total_deleted += sum(int(x) for x in deleted_list)
            batches += 1

    return total_deleted, batches
def main():
    parser = argparse.ArgumentParser(description="Clear Explorer/web-api cache keys from Redis safely.")
    conn = parser.add_argument_group("Connection")
    conn.add_argument("--url", help="Redis URL, e.g., redis://:password@host:6379/0 (overrides other conn args)")
    conn.add_argument("--host", help="Redis host (default env REDIS_HOST or 'localhost')")
    conn.add_argument("--port", help="Redis port (default env REDIS_PORT or 6379)")
    conn.add_argument("--db", help="Redis DB index (default env REDIS_DB or 0)")
    conn.add_argument("--password", help="Redis password (default env REDIS_PASSWORD)")

    target = parser.add_argument_group("Target selection")
    target.add_argument("--prefix", default="web-api:", help="Key prefix to clear (default: %(default)s)")
    target.add_argument("--pattern", help="Full glob-style pattern to match keys (overrides --prefix)")

    behavior = parser.add_argument_group("Behavior")
    behavior.add_argument("--scan-count", type=int, default=DEFAULT_SCAN_COUNT,
                          help=f"SCAN COUNT hint (default: {DEFAULT_SCAN_COUNT})")
    behavior.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE,
                          help=f"Delete batch size (default: {DEFAULT_BATCH_SIZE})")
    behavior.add_argument("--use-del", action="store_true",
                          help="Force DEL (blocking) instead of UNLINK (non-blocking)")
    behavior.add_argument("--dry-run", action="store_true", help="Do not delete; just count & list sample matches")
    behavior.add_argument("--sample", type=int, default=20, help="How many keys to print in dry-run (default: 20)")

    args = parser.parse_args()

    r = make_client_from_env_or_args(args)
    try:
        r.ping()
    except Exception as e:
        print(f"ERROR: Cannot connect to Redis: {e}", file=sys.stderr)
        sys.exit(2)

    pattern = args.pattern if args.pattern else f"{args.prefix}*"

    # Count & (optionally) sample
    found_keys: List[str] = []
    total = 0
    for k in scan_keys(r, pattern, args.scan_count):
        total += 1
        if len(found_keys) < args.sample:
            found_keys.append(k)

    if args.dry_run:
        print(f"[DRY-RUN] Pattern: {pattern}")
        print(f"[DRY-RUN] Total matching keys: {total}")
        if found_keys:
            print(f"[DRY-RUN] First {len(found_keys)} example keys:")
            for k in found_keys:
                print(f"  {k}")
        else:
            print("[DRY-RUN] No matching keys found.")
        return

    if total == 0:
        print(f"No keys found for pattern: {pattern}")
        return

    # Decide UNLINK vs DEL
    use_unlink = not args.use_del and unlink_supported(r)

    print(f"Deleting keys matching pattern: {pattern}")
    print(f"Using {'UNLINK' if use_unlink else 'DEL'} in batches of {args.batch_size}...")
    deleted, batches = delete_keys(r, scan_keys(r, pattern, args.scan_count), use_unlink, args.batch_size)

    print(f"Done. Requested to delete: {total}, actually deleted: {deleted}, batches: {batches}")


if __name__ == "__main__":
    main()
