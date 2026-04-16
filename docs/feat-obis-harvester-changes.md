# feat/obis-harvester — Branch Changes

Branch: `feat/obis-harvester` (from `master` at `255598b`)

## Summary

This branch adds OBIS (Ocean Biodiversity Information System) as a new data source to the CDE pipeline, alongside the existing ERDDAP harvester. It introduces a new `OBISHarvester` class, an `obis_cells` database table, and wires OBIS data through the full stack: harvester, db-loader, web API, and frontend.

It also refactors the harvester architecture to use an abstract `BaseHarvester` class, adds Prefect flow orchestration, and restructures the Docker deployment for development and production.

---

## 1. Harvester Architecture Refactor

### New files
- **`harvester/cde_harvester/base_harvester.py`** — Abstract `BaseHarvester` class with a `harvest() -> HarvestResult` contract. `HarvestResult` is a dataclass containing typed DataFrames: `profiles`, `datasets`, `variables`, `skipped`, `obis_cells`.
- **`harvester/cde_harvester/schemas.py`** — Pandera schema definitions (`ProfileSchema`, `DatasetSchema`, `VariableSchema`, `SkippedDatasetSchema`, `ObisCellSchema`) for DataFrame validation.
- **`harvester/cde_harvester/erddap_harvester.py`** — `ERDDAPHarvester(BaseHarvester)` extracted from the old `harvest_erddap.py`. Now returns a `HarvestResult` and is wrapped with a Prefect `@task` decorator.

### Removed
- **`harvester/cde_harvester/harvest_erddap.py`** — Replaced by `erddap_harvester.py`.

### Modified
- **`harvester/cde_harvester/__main__.py`** — Major rewrite:
  - Added Prefect `@flow` decorator for the `main()` function.
  - Accepts new `obis_dataset_ids` and `obis_folder` parameters.
  - Submits ERDDAP and OBIS tasks concurrently via Prefect.
  - ERDDAP-specific post-processing (CKAN join, title/org cleanup) is conditional — skipped for OBIS-only runs.
  - Merges datasets from both sources into a single `datasets.csv`.
  - Writes `obis_cells.csv` to the output folder.
  - CLI: `--urls` is no longer required; added `--obis-datasets-file`, `--obis-dataset-ids`, `--obis-folder`.
  - Config file: reads `obis_dataset_ids`, `obis_datasets_file`, `obis_folder` from YAML.
  - Added `load_obis_dataset_ids()` helper for resolving OBIS IDs from config or JSON file.

---

## 2. OBIS Harvester

### New files
- **`harvester/cde_harvester/obis_harvester.py`** — `OBISHarvester(BaseHarvester)`:
  - Fetches occurrence data from OBIS S3 parquet files via DuckDB, with REST API fallback.
  - Aggregates occurrences into ~5 nautical mile grid cells (1/12 degree).
  - Fetches dataset metadata from the OBIS API.
  - Enriches with CKAN metadata (EOVs, French titles) via `get_ckan_obis_records()`.
  - Gzip-compressed JSON caching for occurrences and metadata.
  - 5 retry attempts per dataset with cache clearing on failure.
  - Prefect `@task` decorator with `get_run_logger()` for UI log visibility.
- **`harvester/cde_harvester/ckan/create_ckan_obis_link.py`** — `get_ckan_obis_records()` function that looks up OBIS datasets in the CIOOS CKAN catalog by UUID, returning EOVs, French titles, and CKAN IDs. Per-dataset gzip caching.
- **`Obis_Datasets.json`** — List of ~971 OBIS dataset UUIDs to harvest.
- **`testOBISHarvester.py`** — Standalone test script for the OBIS harvester.

---

## 3. Database Schema

### New files
- **`database/migrations/add_obis_cells.sql`** — Migration to add the `obis_cells` table.
- **`database/migrations/add_scientific_names.sql`** — Migration to add `scientific_names` column.
- **`database/migrations/10_add_source_type.sql`** — Migration to add `source_type` column to `datasets`.

### Modified
- **`database/1_schema.sql`** — Added `obis_cells` table (pk, geom, dataset_pk, erddap_url, dataset_id, latitude, longitude, scientific_names[], n_records, time_min/max, depth_min/max, hex columns, point_pk) with spatial indexes. Added `source_type` column to `datasets` table.
- **`database/4_create_hexes.sql`** — Extended `create_hexes()` to also assign hex geometries to `obis_cells`.
- **`database/5_profile_process.sql`** — Added `obis_process()` function: sets geometries, links to datasets/points, updates `n_profiles` count.
- **`database/6_remove_all_data.sql`** — Added `DELETE FROM cde.obis_cells`.
- **`database/9_incremental_upsert.sql`** — Added `temp_obis_cells` table, `replace_obis_cells_from_temp()` function, and integrated OBIS into `process_incremental_update()` workflow.

---

## 4. DB Loader

### Modified
- **`db-loader/cde_db_loader/__main__.py`** —
  - Reads `obis_cells.csv` from the harvest folder (guarded by `os.path.isfile`).
  - `prepare_obis_cells_dataframe()`: parses scientific_names, rounds coordinates, deduplicates on (erddap_url, dataset_id, lat, lon).
  - `load_obis_cells_chunked()`: inserts in 1000-row batches with progress logging.
  - Full-reload mode: loads obis_cells, runs PostGIS geometry processing, links to datasets/points.
  - Incremental mode: loads into `temp_obis_cells`, processed via `process_incremental_update()`.
  - Uses `DB_HOST_EXTERNAL` env var for database connection (overridden to `db` in Docker).

---

## 5. Web API

### Modified
- **`web-api/routes/tiles.js`** — Updated MVT tile queries to include OBIS cells data alongside profiles.
- **`web-api/routes/legend.js`** — Updated legend queries to account for OBIS datasets.
- **`web-api/utils/shapeQuery.js`** — Updated spatial queries to include OBIS cells in point/shape queries.

---

## 6. Frontend

### Modified
- **`frontend/src/components/App.jsx`** — Added debug logging for `/platforms`, `/oceanVariables`, `/datasets` fetches. Added optional chaining for missing platform/EOV metadata (prevents crashes when OBIS datasets have unknown platforms).
- **`frontend/src/components/Controls/DatasetInspector/DatasetInspector.jsx`** — OBIS datasets show "View on OBIS" link instead of ERDDAP URL. Record table is hidden for OBIS datasets (no profile-level data). Skips profile fetch for `source_type === 'obis'`.
- **`frontend/src/components/Controls/SelectionDetails/SelectionDetails.jsx`** — Updated to handle OBIS dataset display.

---

## 7. Prefect Integration

### New files
- **`harvester/cde_harvester/run_flow.py`** — `cde_pipeline()` Prefect flow orchestrating: harvester -> db-loader -> redis refresh as subflows. Entry point for Docker deployments.
- **`harvester/cde_harvester/deploy.py`** — Prefect deployment configuration for container-based execution.
- **`harvester/cde_harvester/redisFunctions.py`** — Redis cache refresh flow.

### Modified
- **`harvester/cde_harvester/__main__.py`** — `main()` decorated with `@flow(name="cde-main")`. ERDDAP and OBIS harvesters dispatched as Prefect `@task`s running concurrently.
- **`harvester/cde_harvester/ERDDAP.py`** — Minor logging adjustments for Prefect compatibility.
- **`harvester/cde_harvester/dataset.py`** — Minor adjustments.

---

## 8. Infrastructure / Docker

### Modified
- **`docker-compose.yaml`** —
  - Added Prefect server service (`prefecthq/prefect:3.6-python3.12-conda`).
  - Harvester service: added `Obis_Datasets.json` and `obis_cache` volume mounts, `PREFECT_LOGGING_LEVEL=INFO`, `DB_HOST_EXTERNAL=db` override.
  - Added `prefect_data` volume.
- **`docker-compose.production.yaml`** — Restructured for production with Prefect worker/deployment services, proper volume mounts, and scheduled execution.
- **`harvester/Dockerfile`** — Updated to copy db-loader dependency and use `run_flow.py` as entry point.
- **`harvester/run.sh`** — Updated entry point script.
- **`nginx/`** — Added Dockerfile, logrotate config, and start script for nginx container.
- **`harvest_config.sample.yaml`** — Added OBIS configuration section (`obis_datasets_file`, `obis_dataset_ids`, `obis_folder`).
- **`.env.sample`** — Added new environment variables.

### New files
- **`docker-compose.tmp`** — Temporary/experimental compose file.
- **`clearPrefect.sh`** — Script to clear Prefect database.

---

## 9. Dependencies

### Modified
- **`harvester/pyproject.toml`** — Added `duckdb>=1.0.0`, `prefect>=3.6.23`, `prefect-docker>=0.6.0`, `redis>=6.4.0`. Bumped other deps.
- **`harvester/uv.lock`** — Updated lockfile with new dependencies.
- **`db-loader/pyproject.toml`** — Minor dependency updates.

---

## 10. Other

- **`CLAUDE.md`** — Added project documentation for AI-assisted development.
- **`docs/obis-branch-overview.md`** — Architecture overview of the OBIS integration.
- **`.gitmodules`** — Added `cioos-metadata-conversion` submodule (feat/load-from-obis branch).
- **`.gitignore`** — Added obis cache/output directories.
- **`README.md`** — Updated with OBIS harvester documentation.
