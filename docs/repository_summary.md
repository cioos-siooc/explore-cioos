# Repository Summary — explore-cioos

> **Start here.** This document answers the key questions a new engineer needs before diving into the codebase.

---

## 1. What does this repository actually do?

**explore-cioos** is a full-stack data discovery and download platform for Canadian ocean science data. It allows researchers to:

1. Visually explore ocean datasets on an interactive map
2. Filter by time range, geographic polygon, platform type, and ocean variable (EOV)
3. Download the resulting data as zipped NetCDF/CSV files delivered by email

---

## 2. What problem does it solve?

Ocean science data in Canada is distributed across dozens of ERDDAP servers operated by different institutions. There is no single interface to search, filter, and download across all of them. This platform:

- **Harvests** dataset metadata from all known ERDDAP servers nightly
- **Indexes** that metadata into a spatial PostgreSQL/PostGIS database
- **Serves** it through a REST API and React frontend
- **Executes** user-requested downloads against the original ERDDAP servers and delivers results by email

---

## 3. What are the core workflows?

### Workflow A — Nightly Data Harvest
```
run.sh (cron)
  → cde_harvester (__main__.py)
      → query each ERDDAP server (ERDDAP.py)
      → validate datasets (CDEComplianceChecker.py)
      → extract metadata + profile stats (dataset.py, profiles.py)
      → write CSVs (datasets.csv, profiles.csv, variables.csv, ckan.csv)
  → cde_db_loader (__main__.py)
      → load CSVs into PostgreSQL (incremental or full reload)
      → run SQL processing (profile_process, create_hexes, etc.)
```

### Workflow B — User Data Discovery
```
Frontend (React + Mapbox)
  → draw polygon / select filters
  → GET /tiles, /datasets, /oceanVariables (web-api Express)
      → Knex queries → PostgreSQL
      → Redis cache (production)
  → display results on map and table
```

### Workflow C — User Data Download
```
Frontend
  → POST /download (web-api)
      → insert row into cde.download_jobs
  → download_scheduler (polling loop)
      → pick up "open" job
      → downloader_wrapper.run_download_query()
          → erddap_downloader: fetch data from ERDDAP servers
          → apply polygon filter, size limits, zip
      → update job status in DB
      → email user download link (Gmail SMTP)
```

---

## 4. What systems does it depend on?

| System | Role |
|--------|------|
| ERDDAP servers (external) | Source of all ocean datasets |
| PostgreSQL 13 + PostGIS 3.1 | Spatial data store |
| CKAN (external) | Organization/publisher metadata |
| Redis | API response caching (production only) |
| Gmail SMTP | Download completion email delivery |
| Nginx | Reverse proxy + static file serving |
| Docker Compose | Service orchestration |

---

## 5. What would break if key modules failed?

| Module | Impact |
|--------|--------|
| `harvester` | Dataset index goes stale; no new datasets appear |
| `db-loader` | Harvested CSVs don't reach the database |
| `web-api` | Frontend shows nothing; downloads cannot be requested |
| `download_scheduler` | Downloads queue up but are never executed; no emails sent |
| `PostgreSQL` | Entire platform is down |
| ERDDAP servers | Harvest fails for those servers; downloads fail for their datasets |

---

## 6. Most important files to understand first

| File | Why |
|------|-----|
| [harvester/cde_harvester/__main__.py](../harvester/cde_harvester/__main__.py) | CLI / Prefect entrypoint |
| [harvester/cde_harvester/prefect_pipeline.py](../harvester/cde_harvester/prefect_pipeline.py) | Top-level Prefect @flow orchestrator |
| [harvester/cde_harvester/erddap_harvester.py](../harvester/cde_harvester/erddap_harvester.py) | ERDDAP dataset discovery and compliance filtering |
| [harvester/cde_harvester/obis_harvester.py](../harvester/cde_harvester/obis_harvester.py) | OBIS occurrence data harvesting |
| [harvester/cde_harvester/base_harvester.py](../harvester/cde_harvester/base_harvester.py) | BaseHarvester ABC and HarvestResult dataclass |
| [harvester/cde_harvester/ERDDAP.py](../harvester/cde_harvester/ERDDAP.py) | ERDDAP API client |
| [harvester/cde_harvester/dataset.py](../harvester/cde_harvester/dataset.py) | Dataset metadata model |
| [db-loader/cde_db_loader/__main__.py](../db-loader/cde_db_loader/__main__.py) | DB load orchestration |
| [database/1_schema.sql](../database/1_schema.sql) | Core schema (understand data model here) |
| [web-api/routes/](../web-api/routes/) | All REST API endpoints |
| [download_scheduler/download_scheduler.py](../download_scheduler/download_scheduler.py) | Download job lifecycle |
| [downloader/erddap_downloader/download_erddap.py](../downloader/erddap_downloader/download_erddap.py) | ERDDAP download logic |

---

## See Also

- [Architecture](architecture.md) — Layer diagrams and component catalog
- [Execution Flow](execution_flow.md) — Step-by-step runtime walkthrough
- [Data Flow](data_flow.md) — How data moves through the system
- [Configuration](configuration.md) — All config variables and sources
- [Integrations](integrations.md) — External system details
- [Dependencies](dependencies.md) — Internal and external dependency graphs
- [Technical Debt](technical_debt.md) — Risk assessment
- [Onboarding Guide](onboarding_guide.md) — Recommended reading order for new engineers
