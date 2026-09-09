# ERDDAP and CKAN Downloader

The CDE downloader retrieves data from CIOOS datasets based on JSON queries. For each dataset, the downloader:

1. Retrieves a PDF copy of the CKAN dataset page (if enabled)
2. Downloads data through ERDDAP in the specified format
3. Filters data spatially to match only data within the provided polygon (for CSV format with polygon region selected)

## Installation

### Using Docker (Recommended)

The downloader runs automatically as part of the download scheduler service in Docker Compose. See the main [README.md](../README.md) for Docker setup instructions.

### Manual Installation

If you need to run the downloader outside of Docker:

1. Create a virtual environment and install dependencies using uv (recommended) or pip:

   ```sh
   # Using uv (recommended)
   uv sync

   # Or using pip
   pip install -e .
   ```

   This will create a local `.venv` directory and install all dependencies including the harvester package.

2. (Optional) Download and install [wkhtmltopdf](https://wkhtmltopdf.org/downloads.html) if you need PDF generation functionality.

## Configuration

Configure the downloader through environment variables in `.env` file at the project root:

- `DOWNLOADS_FOLDER`: Directory for downloaded files (default: `./downloads`)
- `DOWNLOAD_WAF_URL`: Base URL for WAF downloads
- `CREATE_PDF`: Enable/disable PDF generation (default: `False`)

## Usage

The downloader is typically invoked by the download scheduler service.

### Testing

Run the test suite (mocked ERDDAP and OBIS parquet reads, runs offline):

```sh
uv run pytest
# or
./test_downloader.sh
```

Test query fixtures live in `downloader/tests/queries/*.json` (Profile, TimeSeries,
Point, Trajectory) plus `downloader/tests/obis_query.json` for the OBIS parquet path.

To smoke-test a single query against the **live** ERDDAP / OBIS S3 export (network
required):

```sh
./test_downloader.sh tests/queries/no_polygon.json
# or directly:
uv run python -m erddap_downloader tests/queries/no_polygon.json --output_folder out
```

### Dataset types

- **Points / Profile / TimeSeries / Trajectory** — downloaded from ERDDAP as tabledap
  CSV (all variables), filtered to the query's bbox/polygon/time/depth.
- **OBIS** (`source_type = "obis"`) — read from the OBIS open-data GeoParquet export
  (`s3://obis-open-data/occurrence/{id}.parquet`) via DuckDB and written as filtered
  occurrence CSV; these datasets are not ERDDAP-backed.
- **Griddap** (`cdm_data_type = "Grid"`) — not downloadable through this service
  (metadata-only in CDE); users are directed to the dataset's ERDDAP griddap page.
