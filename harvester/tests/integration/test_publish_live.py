"""
Live round trip against the Juno object store. Skipped unless CDE_LIVE_TESTS=1
and JUNO_TEST_BUCKET names a bucket the AWS_* credentials can write:

    CDE_LIVE_TESTS=1 JUNO_TEST_BUCKET=cioos-juno-cde-harvest \\
    AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \\
      uv run pytest tests/integration/test_publish_live.py -q

What only the real gateway can prove: path-style addressing (a virtual-host
request fails on DNS/TLS for <bucket>.objets...), the botocore config and
checksums it accepts, and a publish that fetches back byte for byte. On a
versioned bucket the cleanup leaves delete markers under _smoketest/.
"""

import os
import uuid
from pathlib import Path

import fsspec
import pytest
from cde_harvester.core import publish

BUCKET = os.getenv("JUNO_TEST_BUCKET")

pytestmark = [
    pytest.mark.network,
    pytest.mark.skipif(
        os.getenv("CDE_LIVE_TESTS") != "1" or not BUCKET,
        reason="live Juno test; set CDE_LIVE_TESTS=1 and JUNO_TEST_BUCKET to run",
    ),
]


def test_publish_and_fetch_round_trip(tmp_path, monkeypatch):
    monkeypatch.setenv("AWS_ENDPOINT_URL", os.getenv("AWS_ENDPOINT_URL", "https://objets.juno.calculquebec.ca"))
    monkeypatch.setenv("AWS_DEFAULT_REGION", os.getenv("AWS_DEFAULT_REGION", "us-east-1"))
    files = {"datasets.csv": "erddap_url,dataset_id\nhttps://x/erddap,ds1\n", "profiles.csv": "\n"}
    for name, body in files.items():
        (tmp_path / name).write_text(body)
    url = f"s3://{BUCKET}/_smoketest/{uuid.uuid4()}"

    try:
        publish.publish_folder(tmp_path, url, kind="run")
        with publish.fetched(url) as (folder, manifest):
            fetched = {name: Path(folder, name).read_text() for name in manifest["files"]}
        assert fetched == files
    finally:
        fs, root = fsspec.core.url_to_fs(url, config_kwargs=publish._S3_CONFIG)
        fs.rm(root, recursive=True)
