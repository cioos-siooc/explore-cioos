# Dependencies

## Internal Module Dependency Graph

```
run.sh
 ├── cde_harvester
 │    ├── ERDDAP.py               (HTTP client)
 │    ├── dataset.py              (data model)
 │    │    └── profiles.py        (profile stats)
 │    ├── harvest_erddap.py       (orchestration)
 │    │    ├── ERDDAP.py
 │    │    ├── dataset.py
 │    │    ├── CDEComplianceChecker.py
 │    │    └── utils.py           (EOV mappings, CKAN)
 │    ├── platform_ioos_to_l06.py (vocab mapping)
 │    ├── output.py               (CSV writer)
 │    └── __main__.py             (threading, queue, CLI)
 │
 └── cde_db_loader
      ├── db_loader.py            (full reload)
      ├── incremental_db_loader.py (incremental)
      └── __main__.py             (CLI, strategy selection)

download_scheduler
 ├── download_scheduler.py
 │    ├── downloader_wrapper      (from erddap_downloader package)
 │    │    └── download_erddap.py
 │    │         └── download_pdf.py (optional)
 │    └── download_email.py
 └── __main__.py

web-api
 ├── app.js
 ├── db.js                        (Knex pool, used by all routes)
 ├── cache.js                     (Redis, used by all routes)
 └── routes/
      ├── datasets.js
      ├── tiles.js
      ├── download.js
      ├── downloadEstimate.js
      ├── organizations.js
      ├── oceanVariables.js
      ├── platforms.js
      ├── pointQuery.js
      └── preview.js

frontend
 ├── Map.js                       (Mapbox GL)
 ├── Filter.jsx                   (query state)
 ├── DatasetsTable.jsx
 ├── DownloadDetails.jsx
 └── IntroModal.jsx
```

---

## External Python Dependencies

From `pyproject.toml` / `uv.lock`:

| Package | Version | Used By | Purpose |
|---------|---------|---------|---------|
| pandas | ≥1.3 | harvester, db-loader | DataFrame operations, CSV I/O |
| requests | ≥2.26 | harvester | HTTP calls to ERDDAP, CKAN |
| erddapy | ≥1.0 | harvester | ERDDAP URL builder helpers |
| PyYAML | ≥6.0 | harvester | Config file parsing |
| diskcache | ≥5.0 | harvester | Disk-based HTTP response cache |
| shapely | ≥1.8 | downloader | Polygon geometry + WKT parsing |
| SQLAlchemy | ≥1.4 | db-loader | DB connection + ORM utilities |
| psycopg2-binary | ≥2.9 | db-loader, scheduler | PostgreSQL driver |
| loguru | ≥0.6 | harvester, scheduler | Structured logging |
| sentry-sdk | ≥1.0 | harvester, scheduler | Error tracking |
| tqdm | ≥4.0 | harvester | Progress bars |
| Jinja2 | ≥3.0 | scheduler | Email HTML templating |
| geopandas | optional | downloader | Spatial DataFrame operations |

---

## External Node.js Dependencies

From `web-api/package.json`:

| Package | Purpose |
|---------|---------|
| express | HTTP server framework |
| knex | SQL query builder + connection pooling |
| pg | PostgreSQL driver for Node.js |
| ioredis | Redis client |
| cache-manager | Unified cache abstraction |
| cache-manager-ioredis | Redis backend for cache-manager |
| cors | CORS middleware |
| swagger-ui-express | API documentation UI |
| express-validator | Request validation |
| @sentry/node | Error tracking |
| axios | HTTP client (for internal calls if any) |

From `frontend/package.json`:

| Package | Purpose |
|---------|---------|
| react | UI framework |
| react-dom | DOM rendering |
| mapbox-gl | Interactive map |
| @mapbox/mapbox-gl-draw | Polygon/rectangle drawing tools |
| i18next | Internationalisation |
| react-i18next | React bindings for i18n |
| webpack | Module bundler |
| babel | JS transpiler |

---

## Shared Data Contracts

These JSON files act as shared contracts between harvester and db-loader:

| File | Location | Consumer |
|------|----------|---------|
| `datasets.csv` | `harvest/` folder | db-loader |
| `profiles.csv` | `harvest/` folder | db-loader |
| `variables.csv` | `harvest/` folder | db-loader |
| `ckan.csv` | `harvest/` folder | db-loader |
| `cde_to_goos_eov.json` | `harvester/cde_harvester/` | harvester (EOV mapping) |
| `goos_eov_to_standard_name.json` | `harvester/cde_harvester/` | harvester (CF name mapping) |
| `cioos_erddap_servers.csv` | `harvester/` | harvester (server list) |

---

## Database as Integration Bus

PostgreSQL acts as the integration point between all services:

```
harvester/db-loader ──writes──► cde.datasets
                                cde.profiles
                                cde.organizations
                                cde.variables
                                cde.points
                                cde.hexes_zoom_0/1

web-api ──────────reads───────► all tables above
        ──────writes──────────► cde.download_jobs

download_scheduler ──reads/
                     writes──► cde.download_jobs
```

No direct inter-service HTTP calls exist (other than to ERDDAP/CKAN). PostgreSQL is the single source of truth for all runtime state.
