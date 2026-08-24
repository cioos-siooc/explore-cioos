
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

The harvest config is **not baked into the image** — it must be provided at
runtime. It is resolved in priority order (see
`cde_harvester/core/config.py:resolve_harvest_config_file`):

1. `HARVEST_CONFIG_B64` env var — the whole YAML file base64-encoded on one
   line (used on Coolify, where raw multi-line env values get mangled).
   Generate it with `base64 < harvest_config.yaml | tr -d '\n'`.
2. `HARVEST_CONFIG_YAML` env var — the raw YAML text. Deprecated (multi-line
   env values get mangled in transit); kept for existing deployments.
3. `HARVEST_CONFIG_FILE` env var — path to a mounted config file. The
   docker-compose files set this to `/app/harvester/harvest_config.yaml`, so
   the mounted config is used without needing the `-f` flag.
4. A file mounted at `/app/harvester/harvest_config.yaml`.

If none exists, startup fails with an error listing these options. See the main
[README](../README.md#harvest-configuration) for how config changes propagate
to a running deployment.

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

### Using a Custom Config File
To use a different config file, override the environment variable:
```bash
docker compose run --rm -e HARVEST_CONFIG_FILE=/app/harvester/custom_config.yaml harvester
```

## Output Files

The harvester generates CSV files in the `harvest/` directory:
- `datasets.csv` - Dataset metadata
- `profiles.csv` - Profile/timeseries information
- `ckan.csv` - CKAN metadata
- `skipped.csv` - Datasets that were skipped (with reasons)

These files are then loaded into the database by the
[db-loader](cde_harvester/loading/README.md), which lives in this package at
`cde_harvester.loading` (`python -m cde_harvester.loading --folder harvest`).

## Package layout

```
cde_harvester/
├── __main__.py           # harvest CLI (python -m cde_harvester -f config.yaml)
├── prefect_pipeline.py   # Prefect flows/deployments (harvest -> db-load)
├── core/                 # shared: schemas (CSV contract), db, observability,
│                         # config, harvest reason codes
├── sources/              # one subpackage per harvest source
│   ├── base.py           # BaseHarvester + HarvestResult
│   ├── erddap/           # ERDDAP client, harvester, dataset, compliance, state
│   ├── obis/             # OBIS harvester + geo filter
│   └── ckan/             # CKAN metadata enrichment
├── dataset_types/        # one DatasetTypeHandler per cdm_data_type; the
│                         # registry drives the listing filter + allowlist.
│                         # New type (Trajectory, griddap) = new handler module.
└── loading/              # db-loader (CSV folder -> PostgreSQL cde schema)
```

`cde_db_loader/` is a deprecated shim kept so `python -m cde_db_loader` keeps
working for one deploy cycle.

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
# Optional: WoRMS vernaculars backfill schedule (unset = none)
VERNACULARS_CRON=
# Optional: fire one harvest immediately on (re)deploy (default false)
RUN_ON_DEPLOY=false

# Harvest config file path (optional)
# When set, automatically uses this config file without needing -f flag
# Defaults to harvest_config.yaml if not provided
HARVEST_CONFIG_FILE=/app/harvester/harvest_config.yaml

# Harvester log directory (optional)
HARVESTER_LOG_DIR=/app/harvester/logs
```

The `prefect_worker` runs harvest flows in-process on the `cde-process-pool`
work pool and registers all deployments on startup. Scale with
`docker compose up -d --scale prefect_worker=N`; run extra workers on another
host via `docker-compose.worker.yaml` (set `REGISTER_DEPLOYMENTS=false` there).

On each `HARVESTER_CRON` tick the **`cde-harvest-all`** orchestrator deployment
fans out into **one harvest job per server**: it triggers the per-source
deployment (`cde-harvester-<slug>`) for every configured ERDDAP url plus `obis`,
so each server runs as its own Prefect flow run (own subprocess) with its own
per-server log (`harvest_<ts>_<slug>.log`) and data folder
(`harvest/<slug>/<timestamp>/`), and each loads its own data to the DB
incrementally. Because the orchestrator waits on all of them concurrently, the
worker must allow enough concurrency to run them alongside it — the default
process worker has no `--limit`, which satisfies this. The single-run
`cde-harvester-deployment` (all sources in one flow run) remains registered as an
on-demand fallback with no schedule.

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

# --- OBIS ---
# Discover which OBIS datasets to harvest from the OBIS API: everything from
# the OBIS Canada node, everything from OTN-OBIS, and anything with occurrences
# inside the Canadian EEZ. Resolved fresh at the start of each OBIS harvest.
obis_discovery:
  enabled: true
  nodes:
    - 7dfb2d90-9317-434d-8d4e-64adf324579a   # OBIS Canada
    - 68f83ea7-69a7-44fd-be77-3c3afd6f3cf8   # OTN-OBIS
  geometry: eez        # 'eez' | 'none' | inline WKT
  areas: []            # optional OBIS areaids
  include: []          # dataset UUIDs always added
  exclude: []          # dataset UUIDs always removed
  min_datasets: 700    # abort rather than harvest an implausibly short list

# Harvest a fixed set instead (test mode) — bypasses obis_discovery entirely.
# obis_dataset_ids:
#   - 4b5e4ccb-cf66-44e4-8890-fa68f8404c3f

# Clip OBIS occurrences to Canadian waters. Datasets from the exempt nodes are
# harvested in full. mode: none disables clipping (test use only).
obis_geo_filter:
  mode: canada
  exempt_node_ids:
    - 7dfb2d90-9317-434d-8d4e-64adf324579a
    - 68f83ea7-69a7-44fd-be77-3c3afd6f3cf8

# Shared cache for OBIS occurrence/metadata downloads. Must live outside
# `folder` (per-run directories get pruned).
# obis_folder: ./obis_cache
```

`harvest_config.sample.yaml` in the project root documents every key, including
the precedence rules between `obis_dataset_ids`, `obis_discovery`, and the
legacy `obis_datasets_file`.

### Which OBIS datasets get harvested

Discovery replaces the old hand-maintained `Obis_Datasets.json`, so adding a
Canadian OBIS dataset no longer needs a code change — it is picked up on the
next harvest. To see what the current config would resolve to, without running
a harvest:

```bash
uv run python scripts/discover_obis_datasets.py -f ../harvest_config.yaml \
    --compare ../Obis_Datasets.json --cells ../harvest/obis_cells.csv
```

That prints the per-query counts, the reduced query geometry, and a diff
against a previous list — including how many datasets that actually produced
map cells would be dropped. Re-run it whenever the boundary polygon or the node
list changes.

Discovery is all-or-nothing: if any of its queries fails, the OBIS harvest
fails, so the db-loader never runs and nothing is pruned. `min_datasets` is the
backstop against a short-but-successful list.

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
