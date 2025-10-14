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

1. Install using uv (recommended) or pip:

   ```sh
   # Using uv (recommended)
   uv pip install -e .

   # Or using pip
   pip install -e .
   ```

2. Install the harvester package (required dependency):

   ```sh
   cd ../harvester
   uv pip install -e .
   ```

3. (Optional) Download and install [wkhtmltopdf](https://wkhtmltopdf.org/downloads.html) if you need PDF generation functionality.

## Configuration

Configure the downloader through environment variables in `.env` file at the project root:

- `DOWNLOADS_FOLDER`: Directory for downloaded files (default: `./downloads`)
- `DOWNLOAD_WAF_URL`: Base URL for WAF downloads
- `CREATE_PDF`: Enable/disable PDF generation (default: `False`)

## Usage

The downloader is typically invoked by the download scheduler service. For testing individual downloads, use the test JSON files located in `downloader/test/*.json`.
