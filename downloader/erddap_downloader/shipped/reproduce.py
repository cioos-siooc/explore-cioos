"""Rebuild this package's data files: re-fetch every subset from its recorded
request URLs, apply the same polygon filter (formats.py, the code that built
the package) and compare each file with its sha256 in datapackage.json.

Run from the unzipped package with uv, which installs the versions declared
above and in reproduce.py.lock: uv run reproduce.py
Files are written to ./reproduced/; the originals are never touched.
"""

import hashlib
import json
import shutil
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

try:
    from formats import obis_frame, polygon_regions, write_frame, write_subset
except ImportError as e:
    sys.exit(
        f"{e}\n\nRun this script with uv, which installs its pinned dependencies:\n"
        "    uv run reproduce.py\n"
        "Install uv: https://docs.astral.sh/uv/getting-started/installation/"
    )

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "reproduced"
# Some ERDDAP servers sit behind a WAF that 403s urllib's default User-Agent.
HEADERS = {"User-Agent": "CIOOS-CDE-Downloader/1.0 (+https://catalogue.cioos.ca)"}


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024**2), b""):
            digest.update(block)
    return digest.hexdigest()


def fetch(url, path):
    """False when ERDDAP answers that nothing matches this request."""
    request = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(request, timeout=600) as response, open(path, "wb") as f:
            shutil.copyfileobj(response, f)
    except urllib.error.HTTPError as e:
        if e.code == 404 and "no matching results" in e.read().decode(errors="replace"):
            return False
        raise
    return True


def rebuild(subset, query, regions, tmp):
    out_base = OUT / subset["folder"] / subset["folder"]
    out_base.parent.mkdir(parents=True, exist_ok=True)
    if subset["source_type"] == "obis":
        df = obis_frame(subset["request_urls"][0], query, regions)
        return write_frame(subset["format"], df, out_base) if not df.empty else []
    parts = []
    for i, url in enumerate(subset["request_urls"]):
        part = tmp / f"{subset['folder']}.part{i}"
        if fetch(url, part):
            parts.append(part)
    return write_subset(subset["format"], parts, regions, out_base) if parts else []


def main():
    package = json.loads((ROOT / "datapackage.json").read_text())
    query = package["x-cde-query"]
    regions = polygon_regions(query.get("polygon_region"))
    expected = {r["path"]: r["hash"].removeprefix("sha256:") for r in package["resources"] if "hash" in r}

    differs = 0
    with tempfile.TemporaryDirectory() as tmp:
        for subset in package["x-cde-subsets"]:
            print(f"{subset['dataset_id']}:")
            try:
                files = rebuild(subset, query, regions, Path(tmp))
            except Exception as e:
                print(f"  failed: {type(e).__name__}: {e}")
                differs += 1
                continue
            written = {f["path"].relative_to(OUT).as_posix(): f["path"] for f in files}
            for path in sorted({p for p in expected if p.startswith(subset["folder"] + "/")} | set(written)):
                if path not in written:
                    status = "missing"
                elif path not in expected:
                    status = "extra"
                else:
                    status = "match" if sha256(written[path]) == expected[path] else "differs"
                differs += status != "match"
                print(f"  {status}: {path}")
            if subset["status"] == "PARTIAL":
                print("  note: the package copy was cut off at the size limit, so the full rebuild differs")

    if differs:
        print("\nSome files differ: the source data may have changed since the package was built.")
    print(f"\nRebuilt files are in {OUT}")
    return 1 if differs else 0


if __name__ == "__main__":
    sys.exit(main())
