# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CIOOS Data Explorer (CDE) — a full-stack application for discovering, visualizing, and downloading oceanographic datasets from ERDDAP servers and CKAN catalogs. Data flows: Harvester → CSV files → DB Loader → PostgreSQL → Web API → React Frontend.

## Architecture

```
Frontend (React/Webpack, port 8000 dev)
    ↓
Nginx (port 8098, reverse proxy)
    ├→ Web API (Express/Knex, port 5000)
    │    ├→ PostgreSQL/PostGIS
    │    └→ Redis (cache)
    └→ Static files (frontend build, downloads, logs)

Harvester (Python/Prefect)  →  PostgreSQL
Download Scheduler (Python)  →  PostgreSQL
```

**Key data flow:**
1. `harvester/cde_harvester/` fetches metadata from ERDDAP/CKAN, outputs `harvest/datasets.csv` and `harvest/profiles.csv`
2. `db-loader/cde_db_loader/` loads those CSVs into PostgreSQL (full reload or incremental upsert)
3. `web-api/` serves REST endpoints consumed by the frontend
4. `frontend/src/components/App.jsx` is the React root; Map visualization uses D3.js + Mapbox GL

## Commands

### Frontend
```bash
cd frontend
npm install
npm start          # Dev server on port 8000
npm run build      # Production build
npm run lint
npm run lint:fix
```

### Web API
```bash
cd web-api
npm install
npm start          # Port 5000
npm run lint:fix
```

### Harvester (Python, managed with uv)
```bash
cd harvester
uv sync
uv run python -m cde_harvester -f ../harvest_config.yaml          # Config file mode
uv run python -m cde_harvester --urls <erddap_url> --dataset_ids <id> --cache  # Single dataset
uv run python -m cde_harvester.run_flow                            # Prefect flow runner
```

### DB Loader
```bash
cd db-loader
uv sync
python -m cde_db_loader --folder ../harvest               # Full reload
python -m cde_db_loader --folder ../harvest --incremental # Incremental upsert
```

### Tests
```bash
# API endpoint tests (requires running stack)
cd test && npm ci && node test_api_endpoints.js

# Frontend smoke test (Puppeteer)
cd test && npm ci && node frontend_loads_without_errors.js
```

### Docker (primary way to run everything)
```bash
# Full dev stack
docker compose up -d

# Backend only (for frontend-only dev)
docker compose up -d db web-api redis

# Production
docker compose -f docker-compose.production.yaml up -d --build
```

**Service endpoints:**
- Frontend: http://localhost:8098
- Web API: http://localhost:8098/api
- Prefect UI: http://localhost:4200
- API Docs (Swagger): http://localhost:8098/api/docs (if `ENABLE_API_DOCS=true`)

## Configuration

Copy `.env.sample` → `.env` and `harvest_config.sample.yaml` → `harvest_config.yaml`.

Key `.env` variables: `DB_HOST/USER/PASSWORD/NAME`, `REDIS_HOST`, `API_URL`, `BASE_URL`, `HARVESTER_CRON`, `INCREMENTAL_MODE`, `CORS_ORIGINS`, `SENTRY_DSN`.

## Key Subsystems

### Harvester (`harvester/cde_harvester/`)
- `BaseHarvester` in `base_harvester.py` — abstract base with pandas DataFrame typed outputs (`datasets_df`, `profiles_df`)
- `ErddapHarvester` — fetches ERDDAP metadata and profiles
- `ObisHarvester` — fetches OBIS occurrence data (in progress on `feat/obis-harvester`)
- `ckan/` — links CKAN catalog records to ERDDAP datasets
- Prefect orchestrates scheduling; `HARVESTER_CRON` in `.env` sets the schedule

### Database Schema (`database/`)
SQL scripts run in order at first container start: `1_schema.sql` → `5_profile_process.sql` → `7_contraints.sql` → `9_incremental_upsert.sql`. PostGIS is required for spatial queries.

### Web API (`web-api/`)
- `app.js` — Express setup with Sentry, CORS, routes
- `routes/` — datasets, downloads, tiles (MVT), pointQuery, preview, oceanVariables
- `db.js` — Knex.js query builder

### Frontend (`frontend/src/`)
- `components/App.jsx` — root component, state management
- `components/Map/` — D3.js + Mapbox GL map visualization
- `components/Controls/` — filter panels, download UI, selection details
- i18n: English/French via `react-i18next` (`public/locales/`)
- `API_URL` injected at build time via webpack `DefinePlugin`
