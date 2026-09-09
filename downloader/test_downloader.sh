#!/bin/sh
set -e

# Run the downloader test suite. Assumes the uv environment is set up
# (`uv sync --group dev`); you can also run these via `docker build .` from the
# parent directory.
#
# Default: run the pytest suite (mocked ERDDAP + mocked OBIS parquet, offline).
#   ./test_downloader.sh
#
# Manual smoke test of a single query file against the REAL downloader
# (hits live ERDDAP / OBIS S3 — network required):
#   ./test_downloader.sh tests/queries/no_polygon.json

rm -rf cde_download_* out

if [ -n "$1" ]; then
    query_file="$1"
    echo "Running downloader on ${query_file} (live)"
    uv run python -m erddap_downloader "${query_file}" --output_folder out
    zip_file=$(ls out/*.zip 2>/dev/null | head -1) || true
    if [ -n "${zip_file}" ]; then
        unzip -o "${zip_file}" -d out/unzipped
        echo "Contents:"
        ls -R out/unzipped
        uv run python -c "import pandas,glob; \
            csv_file=glob.glob('out/unzipped/*.csv')[0]; \
            print('Loading', csv_file); \
            print(pandas.read_csv(csv_file).head())"
    else
        echo "No zip produced (empty download or error) — check the run report."
    fi
else
    uv run pytest -q
fi
