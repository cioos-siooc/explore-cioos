# Architecture

## High-Level Architecture Style

**Hybrid: ETL Pipeline + Microservices + Web Application**

The system combines a nightly batch ETL pipeline (harvest → load) with a set of always-on microservices (web API, download scheduler, frontend) backed by a shared PostgreSQL database.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        External Systems                             │
│  ERDDAP Servers (ocean data)        CKAN (org metadata)             │
└──────────────────┬──────────────────────────┬───────────────────────┘
                   │                          │
          ┌────────▼────────┐                 │
          │   Harvester     │◄────────────────┘
          │  (Python ETL)   │  fetches org data per dataset
          └────────┬────────┘
                   │ CSVs (datasets, profiles,
                   │       variables, ckan)
          ┌────────▼────────┐
          │   DB Loader     │
          │  (Python ETL)   │
          └────────┬────────┘
                   │ SQL COPY + UPSERT
          ┌────────▼────────────────────────────────┐
          │         PostgreSQL 13 + PostGIS 3.1      │
          │  schema: cde                             │
          │  tables: datasets, profiles, points,     │
          │          hexes_zoom_0/1, organizations,  │
          │          download_jobs                   │
          └────────┬─────────────────┬──────────────┘
                   │                 │
          ┌────────▼────────┐  ┌─────▼──────────────┐
          │   Web API       │  │ Download Scheduler  │
          │  (Node/Express) │  │  (Python)           │
          │  + Redis Cache  │  └─────┬───────────────┘
          └────────┬────────┘        │
                   │                 │  queries ERDDAP
                   │        ┌────────▼────────┐
                   │        │   Downloader    │
                   │        │  (Python)       │
                   │        └────────┬────────┘
                   │                 │ .zip files
                   │        ┌────────▼────────┐
                   │        │   Nginx (files) │◄──── user email link
                   │        └─────────────────┘
          ┌────────▼────────┐
          │    Nginx        │
          │ (reverse proxy) │
          └────────┬────────┘
                   │ HTTP
          ┌────────▼────────┐
          │   Frontend      │
          │ (React/Mapbox)  │
          └─────────────────┘
```

---

## Architectural Layers

### Presentation Layer
**Component:** `frontend/`
- React 18 SPA with Mapbox GL for spatial interaction
- Webpack bundled, served by Nginx
- Bilingual (English/French via i18n)

### API Layer
**Component:** `web-api/`
- Express.js REST API
- Redis caching in production (5-minute TTL)
- Swagger documentation at `/api-docs`
- Sentry error tracking

### Scheduler / Worker Layer
**Component:** `download_scheduler/`
- Python polling loop (configurable interval)
- Picks up download jobs from PostgreSQL
- Coordinates downloader execution
- Sends email on completion via Gmail SMTP

### Business Logic / ETL Layer
**Components:** `harvester/`, `downloader/`, `db-loader/`
- Harvester: Dataset discovery, compliance checking, metadata extraction
- Downloader: ERDDAP query execution, polygon filtering, size enforcement
- DB Loader: CSV → PostgreSQL with incremental or full-reload strategy

### Data Access Layer
**Components:** `web-api/` (Knex.js), `db-loader/` (SQLAlchemy + psycopg2), `download_scheduler/` (psycopg2)
- Knex.js for API queries (connection pool)
- SQLAlchemy + raw SQL for batch loads
- psycopg2 for job queue polling (FOR UPDATE SKIP LOCKED)

### Persistence Layer
**Component:** `database/`
- PostgreSQL 13 with PostGIS 3.1
- Schema: `cde`
- Hexagonal spatial aggregation (H3-inspired but custom SQL)

### Infrastructure Layer
**Components:** `docker-compose.yaml`, `docker-compose.production.yaml`, `nginx/`
- Docker Compose orchestration
- Nginx reverse proxy with load balancing (4 API replicas in production)
- Named volumes for data persistence

---

## Core Components Catalog

### `cde_harvester` (Python)

| Class / Module | Responsibility |
|----------------|---------------|
| `__main__.py` | Entry point; drives Prefect flow or legacy thread-pool path |
| `prefect_pipeline.py` | Prefect `@flow` orchestration; coordinates ERDDAP and OBIS harvests |
| `erddap_harvester.py` | `ERDDAPHarvester(BaseHarvester)` + Prefect `@task` wrapper; returns `HarvestResult` |
| `obis_harvester.py` | `OBISHarvester(BaseHarvester)`; harvests OBIS occurrence data |
| `base_harvester.py` | `BaseHarvester` ABC and `HarvestResult` dataclass |
| `schemas.py` | Pandera `DataFrameSchema` types for all harvester DataFrames |
| `ERDDAP.py` | HTTP client for ERDDAP REST API; disk-cache support |
| `dataset.py` | `Dataset` class: parses globals, variables, profiles from ERDDAP |
| `profiles.py` | Extracts profile/timeseries IDs and min/max statistics |
| `CDEComplianceChecker.py` | Validates required cf_roles, EOV support, depth/altitude exclusions |
| `utils.py` | EOV/CF standard name mappings, CKAN lookups |
| `platform_ioos_to_l06.py` | IOOS ↔ NERC L06 platform vocabulary translation |
| `redisFunctions.py` | Redis helpers for harvest progress tracking |

### `cde_db_loader` (Python)

| Class / Module | Responsibility |
|----------------|---------------|
| `__main__.py` | CLI entry; chooses full-reload vs incremental path |
| `db_loader.py` | Full-reload: truncate, COPY, run SQL functions |
| `incremental_db_loader.py` | Incremental: temp tables, UPSERT, delete stale rows |

### `erddap_downloader` (Python)

| Class / Module | Responsibility |
|----------------|---------------|
| `download_erddap.py` | Query builder, ERDDAP data fetch, polygon post-filter |
| `downloader_wrapper.py` | Temp dir creation, zip packaging, cleanup |
| `download_pdf.py` | Optional PDF metadata download |

### `download_scheduler` (Python)

| Class / Module | Responsibility |
|----------------|---------------|
| `__main__.py` | Event loop; polls DB at interval |
| `download_scheduler.py` | Job lifecycle: fetch → lock → download → update status → email |
| `download_email.py` | Gmail SMTP email with Jinja2 HTML templates |

### `web-api` (Node.js)

| Module | Responsibility |
|--------|---------------|
| `app.js` | Express setup, middleware, route mounting |
| `routes/datasets.js` | Dataset listing with i18n translations |
| `routes/download.js` | Download job creation and status |
| `routes/tiles.js` | Hexagon tile spatial queries |
| `routes/pointQuery.js` | Point-in-polygon queries |
| `routes/organizations.js` | Organization metadata |
| `routes/oceanVariables.js` | EOV definitions |
| `db.js` | Knex connection pool configuration |
| `cache.js` | Redis cache wrapper |

### `frontend` (React)

| Component | Responsibility |
|-----------|---------------|
| `Map.js` | Mapbox GL map, polygon/rectangle drawing |
| `Filter.jsx` | Sidebar query builder |
| `DatasetsTable.jsx` | Results grid |
| `DownloadDetails.jsx` | Download form + status |
| `IntroModal.jsx` | Welcome/help overlay |

---

## Deployment Topology

### Development
```
docker-compose.yaml
  db          (postgres:13-postgis-3.1)
  web-api     (node, 1 replica)
  nginx       (reverse proxy)
  scheduler   (python)
  frontend    (webpack dev server)
  harvester   (optional, run manually)
```

### Production
```
docker-compose.production.yaml
  db          (postgres:13-postgis-3.1, persistent volume)
  web-api     (4 replicas, load balanced by nginx)
  redis       (cache)
  nginx       (reverse proxy + static files)
  scheduler   (2 replicas, FOR UPDATE SKIP LOCKED ensures no duplicate work)
  harvester   (run via cron/external trigger)
```
