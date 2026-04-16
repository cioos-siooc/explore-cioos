# OBIS Integration — Branch Overview

## Branches

### `harvester_base_class`
**Goal:** Refactor the harvester into a modular, extensible design.

- **`BaseHarvester` abstract class** (`harvester/cde_harvester/base_harvester.py`)
  - All harvesters implement a single `harvest()` method returning a `HarvestResult`
  - `HarvestResult` is a typed dataclass: `profiles`, `datasets`, `variables`, `skipped` DataFrames
- **`ERDDAPHarvester`** extracted from the old monolithic `harvest_erddap.py` into a proper class
- **`run_flow.py`** simplified — now just orchestrates harvesters via the common interface
- **Docker compose split** — dev `docker-compose.yaml` simplified, production moved to `docker-compose.production.yaml`

This branch is the foundation. `feat/obis-harvester` builds on top of it.

---

### `feat/obis-harvester`
**Goal:** Add OBIS (Ocean Biodiversity Information System) as a new data source alongside ERDDAP/CKAN.

#### Harvester (`harvester/cde_harvester/obis_harvester.py`)
- New `OBISHarvester` class extending `BaseHarvester`
- Fetches occurrence records from the OBIS API for a configured list of dataset IDs
- Aggregates raw occurrences into grid cells (unique lat/lon per dataset), capturing:
  - Time range, depth range, record counts
  - Scientific names (species list per cell)
- Pulls CKAN metadata for OBIS datasets via `create_ckan_obis_link.py`
- Outputs `obis_cells.csv` in addition to the standard `datasets.csv` / `profiles.csv`

#### Database
- **New `obis_cells` table** — dedicated table for OBIS grid cells (separate from `profiles`)
  - Stores geometry, scientific names array, time/depth range, record counts, hex assignments
  - Defined in `database/1_schema.sql`; migration for existing DBs: `database/migrations/add_obis_cells.sql`
- **`profiles.scientific_names` column** — added via `database/migrations/add_scientific_names.sql`
- **`datasets.source_type` column** — distinguishes `'erddap'` vs `'obis'` datasets
- **`obis_process()` SQL function** (in `database/5_profile_process.sql`) — computes geometries, links cells to datasets, populates `points` table, updates `n_profiles`
- **`create_hexes()`** updated to copy hex assignments back to `obis_cells`

#### DB Loader (`db-loader/cde_db_loader/__main__.py`)
- Reads `obis_cells.csv` if present and writes it to the new table
- Calls `obis_process()` after the standard `profile_process()`

---

## Current Status
- Pipeline runs end-to-end: ~81k OBIS cells harvested and loaded into the DB
- **Known issue:** `create_hexes()` is slow with the larger global point set from OBIS data — under investigation
