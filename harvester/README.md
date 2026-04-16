
# CIOOS Data Explorer Harvester


The CDE harvester is a tool that discovers and indexes oceanographic datasets from ERDDAP servers and CKAN catalogs. It crawls ERDDAP servers, extracts dataset metadata, validates compliance, and stores the information in a PostgreSQL database to power the CIOOS Data Explorer search interface.

## What It Does

The harvester performs the following tasks:

1. **Discovers Datasets**: Connects to one or more ERDDAP servers and retrieves a list of all available datasets
2. **Extracts Metadata**: For each dataset, collects metadata including:
   - Title, summary, and attribution
   - Temporal and spatial coverage (bounding boxes, time ranges)
   - Variables and their standard names
   - Data types (timeseries, profile, trajectory, etc.)
   - Platform information
3. **Links CKAN Records**: Matches ERDDAP datasets with their corresponding CKAN catalog entries
4. **Validates Compliance**: Checks datasets against CDE requirements and CF conventions
5. **Stores in Database**: Saves all harvested metadata to PostgreSQL for the web API to query

The harvester is typically run periodically (via the Docker harvester profile) to keep the database up-to-date with the latest datasets.

## Installation

### Using Docker (Recommended)

The harvester runs as a Docker profile in the main compose file. See the main [README.md](../README.md) for setup instructions.

To run the harvester with Docker:

```bash
# Development environment
docker compose up -d harvester

# Production environment
docker compose -f docker-compose.production.yaml up -d harvester
```
### Using uv (recommended for local development)

```bash
cd harvester
uv sync
```

This will create a local `.venv` directory and install all dependencies including the db-loader package.

### Using venv and pip

```bash
cd harvester
python -m venv venv
source ./venv/bin/activate
pip install .
```

## Running Standalone

The harvester reads from `harvest_config.yaml` by default, but you can override with command-line options:

### Harvest from specific ERDDAP servers
```bash
python -m cde_harvester --urls https://catalogue.hakai.org/erddap,https://www.smartatlantic.ca/erddap
```

### Harvest specific dataset IDs (comma separated)
```bash
python -m cde_harvester --urls https://catalogue.hakai.org/erddap --dataset_ids HakaiQuadraBoLResearch
```

### Use request caching (faster for testing)
```bash
python -m cde_harvester --urls https://catalogue.hakai.org/erddap --cache
```

## Running with Docker

The harvester is typically run via Docker Compose. See the main [README](../README.md) for details.

### Full Reload Mode (default)
Clears all existing data and reloads everything from scratch:
```bash
docker compose run --rm harvester
```

### Incremental Mode
Updates only changed datasets, preserving existing data (much faster):
```bash
docker compose run --rm -e INCREMENTAL_MODE=true harvester
# Or use the convenience script:
./run_harvester.sh --incremental
```

## Output Files

The harvester generates CSV files in the `harvest/` directory:
- `datasets.csv` - Dataset metadata
- `profiles.csv` - Profile/timeseries information
- `ckan.csv` - CKAN metadata
- `skipped.csv` - Datasets that were skipped (with reasons)

These files are then loaded into the database by the [db-loader](../db-loader/README.md).

## Configuration

Create `harvest_config.yaml` from `harvest_config.sample.yaml`:
```yaml
erddap_urls:
  - https://data.cioospacific.ca/erddap
  - https://catalogue.hakai.org/erddap
  # Add more ERDDAP servers here

# Optional: Limit to specific datasets
# dataset_ids:
#   - dataset_id_1
#   - dataset_id_2
```

## Standalone CKAN Harvester

For testing purposes only (normally called by ERDDAP harvester):
```bash
python -m cde_harvester.ckan
```
## Configuration

### Environment Variables

Configure the harvester through a `.env` file in the harvester directory (copy from `.env.sample`):

```bash
# Database connection
DB_USER=postgres
DB_PASSWORD=password
DB_HOST=localhost  # Use 'db' when running in Docker
DB_NAME=cde

# Sentry error tracking (optional)
SENTRY_DSN=your_sentry_dsn_here
ENVIRONMENT=development  # or production

# Path to your project root on the host machine (required for Docker volume mounting)
HOST_ROOT=/path/to/your/workspace/explore-cioos

# Optional: Harvester schedule (defaults to None unset)
HARVESTER_CRON=10 0 */3 * *
```

### Configuration File

The harvester can be configured using a YAML file. Copy `harvest_config.yaml` from the project root and customize:

```yaml
# List of ERDDAP URLs to harvest (must end in /erddap)
erddap_urls:
  - https://erddap.SOME_ERDDAP.com/erddap

# Enable request caching for testing (not for production)
cache: false

# Output folder for harvested JSON files
folder: harvest

# Filter specific datasets (for testing)
dataset_ids:
  # - ECCC_MSC_BUOYS
  # - HakaiQuadraBoLResearch

# Add timestamps to log output
log_time: false

# Directory to save log files (optional)
# Use absolute path for Docker: /app/harvester/logs
# Use relative path for local: ../harvester_logs
log_dir: ../harvester_logs

# Logging level (DEBUG, INFO, WARNING, ERROR)
log_level: INFO

# Maximum concurrent threads for harvesting
max_workers: 1
```

A list of CIOOS ERDDAP servers is maintained in [cioos_erddap_servers.csv](cioos_erddap_servers.csv).

## Usage

### Using Configuration File (Recommended)

```bash
uv run python -m cde_harvester -f harvest_config.yaml

# Or if using venv/pip
python -m cde_harvester -f harvest_config.yaml
```

### Using Command Line Arguments

Harvest from specific ERDDAP servers:

```bash
uv run python -m cde_harvester --urls https://catalogue.hakai.org/erddap,https://www.smartatlantic.ca/erddap
```

Harvest specific datasets only (useful for testing):

```bash
uv run python -m cde_harvester \
  --urls https://catalogue.hakai.org/erddap \
  --dataset_ids HakaiQuadraBoLResearch,ECCC_MSC_BUOYS
```

Enable request caching for testing:

```bash
uv run python -m cde_harvester \
  --urls https://catalogue.hakai.org/erddap \
  --cache
```

Adjust logging verbosity:

```bash
uv run python -m cde_harvester \
  --urls https://data.cioospacific.ca/erddap \
  --log-level debug \
  --log-time
```

Use multiple threads for faster harvesting:

```bash
uv run python -m cde_harvester \
  -f harvest_config.yaml \
  --max-workers 4
```

### Command Line Options

- `--urls`: Comma-separated list of ERDDAP server URLs (required if not using `-f`)
- `--dataset_ids`: Comma-separated list of specific dataset IDs to harvest (optional, useful for testing)
- `--cache`: Enable HTTP request caching for testing (not for production)
- `--folder`: Directory to save harvested JSON files (default: `harvest`)
- `--log-level`: Logging level - debug, info, warning, error (default: `debug`)
- `--log-time`: Include timestamps in log output
- `--max-workers`: Number of concurrent threads (default: `1`)
- `-f`, `--file`: Path to YAML configuration file (alternative to command line args)

## Output

The harvester produces:

1. **JSON Files**: Saved to the `harvest/` folder (or configured folder):
   - `{hostname}_datasets.json`: All dataset metadata from each ERDDAP server
   - `{hostname}_skipped.json`: List of datasets that were skipped and why
   - `{hostname}_profiles.json`: Profile-specific data for vertical profile datasets

2. **Database Records**: Inserts/updates records in PostgreSQL tables:
   - `datasets`: Main dataset metadata
   - `dataset_variables`: Variables and their standard names
   - `profiles`: Vertical profile information
   - And various other tables for spatial/temporal coverage

3. **Logs**: Console output and optional log files (if `log_dir` is configured)

## Standalone CKAN Harvester

For testing the CKAN harvester independently:

```bash
uv run python -m cde_harvester.ckan
```

This is normally called automatically by the ERDDAP harvester to link datasets with their CKAN catalog entries.

## Updating CF Standard Names

The harvester uses a locally cached copy of the CF standard names table (`cde_harvester/data/cf_standard_names.csv`). To update it to the latest version from cfconventions.org:

```bash
python -m cde_harvester.utils
```

## Troubleshooting

### Skipped Datasets

Some datasets may be skipped during harvesting if they:
- Have an unsupported CDM data type
- Return HTTP errors when accessing metadata
- Don't meet CDE compliance requirements

Check the `*_skipped.json` files in the output folder for details.

### Performance

- Use `--max-workers` to parallelize harvesting across multiple threads
- Use `--cache` during development to avoid repeated HTTP requests
- Filter to specific datasets with `--dataset_ids` when testing changes

### Database Connection

If running locally outside Docker:
- Ensure PostgreSQL is running (can use `docker compose up -d db`)
- Set `DB_HOST=localhost` in your `.env` file
- Verify database credentials match your PostgreSQL configuration
