# ERDDAP Harvester

The ERDDAP harvester crawls ERDDAP servers to extract dataset metadata and profile information. It also calls the CKAN harvester to gather additional metadata.

## Installation with venv

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
