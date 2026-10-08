"""Publish harvest run folders to object storage, and fetch them back.

The destination is ``CDE_PUBLISH_URL``: ``s3://<bucket>/<env>`` on the Juno Ceph
gateway (``AWS_ACCESS_KEY_ID`` / ``AWS_SECRET_ACCESS_KEY`` / ``AWS_ENDPOINT_URL``),
or any other fsspec URL (``file://``, ``memory://`` in tests). Unset means
nothing is published.

A published prefix holds each top-level CSV gzipped (``<name>.csv.gz``) and a
``_manifest.json`` written last, listing every file with the size and sha256 of
its uncompressed bytes. A prefix without a manifest is an interrupted upload
and is never read.
"""

import gzip
import hashlib
import json
import os
import tempfile
import urllib.parse
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

import fsspec

MANIFEST = "_manifest.json"
LAYOUT = 1

_S3_SCHEMES = ("s3", "s3a")
# Bounded so an unreachable bucket costs a run minutes, not a worker slot: the
# harvest-all orchestrator holds one of the worker's two slots, so a hung
# publish would stall every source queued behind it.
_S3_CONFIG = {
    "connect_timeout": 10,
    "read_timeout": 60,
    "retries": {"max_attempts": 3, "mode": "standard"},
    # Juno's gateway has no wildcard DNS or certificate, so virtual-host
    # addressing (<bucket>.objets...) cannot work.
    "s3": {"addressing_style": "path"},
}
# Wall-clock ceiling per object call. read_timeout alone does not bound a PUT:
# it is sent with Expect: 100-continue and the read timer only starts after the
# body, so a gateway that accepts the connection and never answers hangs forever.
_S3_CALL_TIMEOUT = 300


def publish_url():
    """``CDE_PUBLISH_URL`` without a trailing slash, or None when unset.

    The URL must name a prefix below the bucket (``s3://bucket/production``, not
    ``s3://bucket``): a run is a delta against the database it was harvested
    for, so two databases sharing one prefix could load each other's runs.
    """
    url = (os.environ.get("CDE_PUBLISH_URL") or "").strip().rstrip("/")
    if not url:
        return None
    parts = urllib.parse.urlsplit(url)
    if not parts.scheme or not parts.path.strip("/"):
        raise ValueError(
            f"CDE_PUBLISH_URL={url!r} must be a URL with a per-database prefix, "
            "e.g. s3://cioos-juno-cde-harvest/production"
        )
    return url


def _is_s3(url):
    return urllib.parse.urlsplit(url).scheme in _S3_SCHEMES


def check_credentials(url):
    """Fail early on an s3 URL with no credentials.

    The Juno gateway answers an unauthenticated request with ``NoSuchBucket``
    (404), not ``AccessDenied``, so a missing key would otherwise look exactly
    like a deleted bucket.
    """
    if not _is_s3(url):
        return
    missing = [v for v in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY") if not os.environ.get(v)]
    if missing:
        raise RuntimeError(
            f"{url} needs S3 credentials but {' and '.join(missing)} "
            f"{'is' if len(missing) == 1 else 'are'} unset. Without them the "
            "gateway returns a 404 that looks like a missing bucket."
        )


def _fs(url):
    """``(fs, root, call_kwargs)``; pass ``call_kwargs`` to every call on ``fs``."""
    check_credentials(url)
    if not _is_s3(url):
        fs, root = fsspec.core.url_to_fs(url)
        return fs, root.rstrip("/"), {}
    fs, root = fsspec.core.url_to_fs(url, config_kwargs=_S3_CONFIG)
    return fs, root.rstrip("/"), {"timeout": _S3_CALL_TIMEOUT}


def publish_folder(local_dir, dest_url, **manifest_fields):
    """Upload ``local_dir``'s top-level CSVs to ``dest_url``, then the manifest.

    ``manifest_fields`` (e.g. ``kind``, ``incremental``) are recorded in the
    manifest. Returns the manifest.
    """
    fs, root, call = _fs(dest_url)
    # s3fs's makedirs creates the *bucket* when it can't see one, which is what
    # a revoked key or a misspelled bucket looks like on Juno; pipe_file
    # creates keys on its own.
    if not _is_s3(dest_url):
        fs.makedirs(root, exist_ok=True)

    files = {}
    for path in sorted(Path(local_dir).glob("*.csv")):
        raw = path.read_bytes()
        # mtime=0 keeps the gzip bytes a pure function of the CSV.
        fs.pipe_file(f"{root}/{path.name}.gz", gzip.compress(raw, compresslevel=6, mtime=0), **call)
        files[path.name] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    if not files:
        raise FileNotFoundError(f"No CSV files to publish in {local_dir}")

    manifest = {
        "layout": LAYOUT,
        **manifest_fields,
        "published_at": datetime.now(UTC).isoformat(),
        "files": files,
    }
    fs.pipe_file(f"{root}/{MANIFEST}", json.dumps(manifest, indent=1).encode(), **call)
    return manifest


@contextmanager
def fetched(url):
    """Yield ``(folder, manifest)``: a verified local copy of a published prefix.

    The loader must only ever read a complete local folder. It checks for its
    optional files with ``os.path.isfile``, so a file it cannot see reads as "no
    data", and an incremental load then deletes that data. A plain path (no
    scheme) is an unpublished local run folder and is yielded as-is, with no
    manifest.
    """
    if "://" not in url:
        yield url, None
        return

    fs, root, call = _fs(url)
    try:
        manifest = json.loads(fs.cat_file(f"{root}/{MANIFEST}", **call))
    except FileNotFoundError:
        raise FileNotFoundError(
            f"No {MANIFEST} under {url}: not a published run, or its upload never finished"
        ) from None

    with tempfile.TemporaryDirectory(prefix="cde_fetched_") as tmp:
        for name, meta in manifest["files"].items():
            if Path(name).name != name:
                raise ValueError(f"Manifest under {url} names a file outside the prefix: {name!r}")
            raw = gzip.decompress(fs.cat_file(f"{root}/{name}.gz", **call))
            if hashlib.sha256(raw).hexdigest() != meta["sha256"]:
                raise ValueError(f"{url}/{name}.gz does not match its manifest checksum")
            Path(tmp, name).write_bytes(raw)
        yield tmp, manifest
