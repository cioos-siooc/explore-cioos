# Onboarding Guide

## Recommended Reading Order

Work through the files below in sequence. Each step builds context for the next.

---

### Step 1 — Understand the Problem Domain

**Read:** [docs/repository_summary.md](repository_summary.md)

Answers: what does this platform do, why does it exist, and what are the three core workflows.

---

### Step 2 — Understand the Data Model

**Read:** [database/1_schema.sql](../database/1_schema.sql)

The schema is the shared contract between all services. Before touching any Python or JavaScript code, understand:
- What a `dataset` is vs a `profile` vs a `point`
- What `hexes_zoom_0` and `hexes_zoom_1` are (pre-computed spatial aggregations)
- What columns `download_jobs` has and what the `status` lifecycle is

**Also read:** [database/2_functions.sql](../database/2_functions.sql)

The SQL functions `profile_process()`, `ckan_process()`, and `create_hexes()` are where the heavy data transformation happens after CSV load.

---

### Step 3 — Understand the Harvest Pipeline

**Read in order:**

1. [harvester/cde_harvester/__main__.py](../harvester/cde_harvester/__main__.py) — CLI entry point, threading setup
2. [harvester/cde_harvester/harvest_erddap.py](../harvester/cde_harvester/harvest_erddap.py) — per-server orchestration
3. [harvester/cde_harvester/ERDDAP.py](../harvester/cde_harvester/ERDDAP.py) — ERDDAP HTTP client
4. [harvester/cde_harvester/dataset.py](../harvester/cde_harvester/dataset.py) — Dataset class (metadata model)
5. [harvester/cde_harvester/CDEComplianceChecker.py](../harvester/cde_harvester/CDEComplianceChecker.py) — validation rules
6. [harvester/cde_harvester/profiles.py](../harvester/cde_harvester/profiles.py) — profile stat extraction
7. [harvester/cde_harvester/utils.py](../harvester/cde_harvester/utils.py) — EOV/CKAN helpers
8. [harvester/cde_harvester/output.py](../harvester/cde_harvester/output.py) — CSV writer

At this point you understand what data enters the system and why some datasets are excluded.

---

### Step 4 — Understand DB Loading

**Read:**

1. [db-loader/cde_db_loader/__main__.py](../db-loader/cde_db_loader/__main__.py) — entry point, strategy selection
2. [db-loader/cde_db_loader/db_loader.py](../db-loader/cde_db_loader/db_loader.py) — full reload path
3. [db-loader/cde_db_loader/incremental_db_loader.py](../db-loader/cde_db_loader/incremental_db_loader.py) — incremental path

At this point you understand the full harvest → load → database cycle.

---

### Step 5 — Understand the API

**Read:**

1. [web-api/app.js](../web-api/app.js) — Express setup, middleware stack
2. [web-api/db.js](../web-api/db.js) — database connection pool
3. [web-api/routes/datasets.js](../web-api/routes/datasets.js) — most complex route
4. [web-api/routes/tiles.js](../web-api/routes/tiles.js) — spatial hex queries
5. [web-api/routes/download.js](../web-api/routes/download.js) — job insertion

At this point you understand how the database is exposed to the frontend.

---

### Step 6 — Understand the Download Pipeline

**Read:**

1. [download_scheduler/download_scheduler.py](../download_scheduler/download_scheduler.py) — job lifecycle
2. [downloader/erddap_downloader/downloader_wrapper.py](../downloader/erddap_downloader/downloader_wrapper.py) — wrapper
3. [downloader/erddap_downloader/download_erddap.py](../downloader/erddap_downloader/download_erddap.py) — ERDDAP queries + polygon filter
4. [download_scheduler/download_email.py](../download_scheduler/download_email.py) — email delivery

---

### Step 7 — Understand the Frontend

**Read:**

1. [frontend/src/Map.js](../frontend/src/Map.js) — Mapbox integration, draw tools
2. [frontend/src/Filter.jsx](../frontend/src/Filter.jsx) — query state management
3. [frontend/src/DatasetsTable.jsx](../frontend/src/DatasetsTable.jsx) — results display
4. [frontend/src/DownloadDetails.jsx](../frontend/src/DownloadDetails.jsx) — download form

---

### Step 8 — Understand the Configuration

**Read:** [docs/configuration.md](configuration.md)

Then look at `docker-compose.yaml` to see how env vars flow into containers.

---

### Step 9 — Run It Locally

```bash
# 1. Copy environment file
cp .env.example .env
# Edit .env: set DB_NAME, DB_USER, DB_PASSWORD, API_URL, BASE_URL

# 2. Start core services
docker compose up db web-api nginx frontend

# 3. Run a test harvest (small config)
cp harvest_config.test.yaml harvest_config.yaml
docker compose run --rm harvester python -m cde_harvester -f harvest_config.yaml

# 4. Load harvested data
docker compose run --rm db-loader python -m cde_db_loader --folder harvest

# 5. Open browser at http://localhost
```

---

### Step 10 — Read the Technical Debt Document

**Read:** [docs/technical_debt.md](technical_debt.md)

Understand the known risks before making changes — especially around full-reload atomicity and the download retry gap.

---

## Key Concepts Glossary

| Term | Meaning |
|------|---------|
| ERDDAP | Scientific data server software; provides REST API for ocean datasets |
| EOV | Essential Ocean Variable — standardized names for ocean measurements (e.g., "Sea Surface Temperature") |
| CF standard name | Climate and Forecast convention variable name (e.g., `sea_water_temperature`) |
| GOOS EOV | Global Ocean Observing System EOV classification |
| cf_role | ERDDAP attribute indicating dataset type: `timeSeries`, `profile`, or `trajectory` |
| Profile | A single vertical cast or time-series at a fixed location |
| Hexes | Pre-computed hexagonal spatial bins for fast map tile rendering |
| CKAN | Open data portal software; used here as an organization registry |
| NERC L06 | BODC SeaVoX Platform Categories vocabulary (platform type codes) |
| IOOS | Integrated Ocean Observing System platform type codes |
| Incremental mode | DB load strategy that only updates changed records (vs full truncate + reload) |
