# Data Flow

## Overview

Data enters the system from external ERDDAP servers, is transformed and indexed into PostgreSQL, then served to users who can download subsets back to ERDDAP servers on demand.

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                    INPUTS (External)                                │
│                                                                     │
│  ERDDAP Servers                     CKAN                           │
│  - dataset metadata (globals)       - organization records          │
│  - variable metadata                  (name, logo, color)           │
│  - profile IDs + statistics                                         │
│  - raw data (on download)                                           │
└──────────┬──────────────────────────────┬───────────────────────────┘
           │                              │
           ▼                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    HARVESTER (Transform)                            │
│                                                                     │
│  1. Fetch dataset list per ERDDAP server                            │
│  2. Fetch metadata (globals + variables) per dataset                │
│  3. Validate compliance (EOV support, cf_role, depth/alt)           │
│  4. Extract profile IDs + min/max (time, depth, lat/lon)            │
│  5. Map EOVs: CDE → GOOS → CF standard names                        │
│  6. Map platforms: IOOS codes → NERC L06 codes                      │
│  7. Lookup organization data from CKAN                              │
└──────────┬──────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    INTERMEDIATE (CSV Files)                         │
│                                                                     │
│  harvest/datasets.csv    - one row per compliant dataset            │
│  harvest/profiles.csv    - one row per profile/timeseries           │
│  harvest/variables.csv   - one row per variable per dataset         │
│  harvest/ckan.csv        - one row per organization                 │
└──────────┬──────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    DB LOADER (Load)                                 │
│                                                                     │
│  COPY CSVs → staging tables                                         │
│  Run SQL: profile_process()  → link profiles to datasets            │
│  Run SQL: ckan_process()     → upsert organizations                 │
│  Run SQL: create_hexes()     → build spatial aggregations           │
│  Run SQL: set_constraints()  → re-add foreign keys                  │
└──────────┬──────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    POSTGRESQL (Persistence)                         │
│                                                                     │
│  cde.datasets        cde.profiles       cde.organizations           │
│  cde.variables       cde.points         cde.hexes_zoom_0/1          │
│                      cde.download_jobs                              │
└──────────┬─────────────────────────────┬───────────────────────────┘
           │                             │
           ▼                             ▼
┌──────────────────┐           ┌──────────────────────────────────────┐
│   WEB API        │           │   DOWNLOAD SCHEDULER                 │
│                  │           │                                      │
│  Knex queries    │           │  Polls download_jobs table           │
│  PostGIS spatial │           │  Triggers erddap_downloader          │
│  Redis cache     │           │  Updates job status                  │
└────────┬─────────┘           └──────────────┬───────────────────────┘
         │                                    │
         ▼                                    ▼
┌──────────────────┐           ┌──────────────────────────────────────┐
│   FRONTEND       │           │   ERDDAP SERVERS (Data Download)     │
│                  │           │                                      │
│  Map tiles       │           │  Actual oceanographic data rows      │
│  Dataset table   │           │  (CSV/NetCDF streams)                │
│  Filter UI       │           └──────────────┬───────────────────────┘
└──────────────────┘                          │
                                              ▼
                               ┌──────────────────────────────────────┐
                               │   OUTPUTS                            │
                               │                                      │
                               │  downloads/{job_id}.zip              │
                               │    (served by Nginx)                 │
                               │                                      │
                               │  Email → user with download link     │
                               └──────────────────────────────────────┘
```

---

## Data Schemas

### `datasets.csv` (Harvester Output)

| Column | Type | Description |
|--------|------|-------------|
| dataset_id | string | ERDDAP dataset identifier |
| erddap_url | string | Base URL of source ERDDAP server |
| title | string | Dataset title |
| title_fr | string | French title (if available) |
| summary | string | Description |
| platform | string | Platform type (NERC L06 code) |
| eovs | JSON array | List of supported EOV names |
| organizations | JSON array | CKAN organization IDs |
| time_min / time_max | datetime | Temporal coverage |
| lat_min / lat_max | float | Bounding box |
| lon_min / lon_max | float | Bounding box |

### `profiles.csv` (Harvester Output)

| Column | Type | Description |
|--------|------|-------------|
| profile_id | string | Unique profile/timeseries identifier |
| dataset_id | string | FK to datasets |
| latitude | float | Profile location |
| longitude | float | Profile location |
| time_min / time_max | datetime | Profile temporal range |
| depth_min / depth_max | float | Profile depth range |
| n_records | int | Number of data rows |

### `variables.csv` (Harvester Output)

| Column | Type | Description |
|--------|------|-------------|
| dataset_id | string | FK to datasets |
| variable_name | string | CF standard name |
| eov | string | Mapped EOV name |

---

## Validation Rules (CDEComplianceChecker)

A dataset is harvested only if ALL of the following are true:

1. Has at least one `cf_role` in `{timeSeries, profile, trajectory}`
2. Has at least one variable mapping to a supported CDE EOV
3. Does NOT have both `depth` and `altitude` variables (ambiguous vertical axis)
4. Is not in the explicit exclusion list

Datasets failing validation are recorded in `cde.skipped_datasets` with the failure reason.

---

## Download Data Flow Detail

```
User request: { polygon_wkt, start_date, end_date, dataset_ids[], email }
  │
  ▼
web-api: INSERT INTO cde.download_jobs
  → job_id returned to frontend
  │
  ▼
download_scheduler picks up job
  │
  ├── for each dataset_id:
  │     Build ERDDAP URL:
  │       /erddap/tabledap/{id}.csv
  │         ?time>={start}&time<={end}
  │         &latitude>={lat_min}&latitude<={lat_max}   ← bounding box
  │         &longitude>={lon_min}&longitude<={lon_max}
  │         &{mandatory_vars},{eov_vars}
  │
  │     Stream response → parse CSV
  │
  │     If polygon (not just bbox):
  │       filter rows: Shapely point-in-polygon test
  │
  │     If crosses 180° meridian:
  │       duplicate query with adjusted lon bounds
  │
  │     Check size: > 1GB/dataset → skip dataset, log warning
  │                 > 5GB total   → stop, mark job "over-limit"
  │
  └── zip all per-dataset CSVs → {job_id}.zip

UPDATE cde.download_jobs SET status='completed', url=...
send email → user
```

---

## EOV Vocabulary Mapping

Data enters ERDDAP with CF standard variable names. The platform maps these to user-facing EOV labels:

```
CF standard name (e.g. "sea_water_temperature")
  ↓  [goos_eov_to_standard_name.json inverse lookup]
GOOS EOV (e.g. "Temperature")
  ↓  [cde_to_goos_eov.json inverse lookup]
CDE EOV display name (e.g. "Sea Water Temperature")
  ↓  [stored in cde.variables, cde.datasets.eovs]
Frontend filter label
```
