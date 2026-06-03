# Execution Flow

## Entry Points

| Entry Point | How Started | Purpose |
|-------------|-------------|---------|
| `harvester/run.sh` | cron job / manual | Trigger nightly harvest + DB load |
| `python -m cde_harvester` | CLI / Docker | Harvest ERDDAP servers to CSVs |
| `python -m cde_db_loader` | CLI / Docker | Load CSVs into PostgreSQL |
| `python -m download_scheduler` | Docker / systemd | Poll and execute download jobs |
| `node app.js` (web-api) | Docker | REST API server |
| `webpack-dev-server` / Nginx | Docker | Frontend |

---

## Workflow A — Nightly Harvest + DB Load

### Step-by-step

```
1. run.sh (cron, e.g. daily at 2am)
   ├── sets LOG_DIR, CONFIG_FILE from env
   ├── python -m cde_harvester -f harvest_config.yaml
   │     └── see Harvester Flow below
   └── python -m cde_db_loader --folder harvest [--incremental]
         └── see DB Loader Flow below
```

### Harvester Flow

```
cde_harvester/__main__.py
  │
  ├── load harvest_config.yaml (erddap_urls, filters, cache settings)
  ├── load EOV mappings (cde_to_goos_eov.json, goos_eov_to_standard_name.json)
  ├── load platform mappings (platform_ioos_to_l06.py)
  │     └── download from MMISW ontology or use cached CSV
  │
  ├── create ThreadPoolExecutor (max_workers from config)
  ├── create Queue of ERDDAP server URLs
  │
  └── prefect_pipeline.run_harvest() [Prefect @flow]
        │
        ├── for each ERDDAP server URL:
        │     erddap_harvester.harvest_erddap(url) [Prefect @task]
        │       ERDDAPHarvester.harvest()
        │         ├── ERDDAP(url) — fetch allDatasets.csv
        │         ├── for each dataset_id:
        │         │     erddap.get_dataset(id)
        │         │       ├── fetch globals  → /erddap/info/{id}/index.csv
        │         │       ├── CDEComplianceChecker.passes_all_checks()
        │         │       └── [if compliant] profiles.get_profiles(dataset)
        │         └── returns HarvestResult(profiles, datasets, variables, skipped, attempts)
        │
        ├── obis_harvester.harvest_obis() [Prefect @task]
        │     OBISHarvester.harvest()
        │       ├── fetch OBIS occurrence data within Canada EEZ
        │       ├── obis_geo_filter — filter to Canadian waters
        │       └── returns HarvestResult(obis_cells=…)
        │
        └── db_loader — load all HarvestResult DataFrames into PostgreSQL
```

### DB Loader Flow

#### Full Reload (default)

```
cde_db_loader/__main__.py
  │
  ├── connect to PostgreSQL (SQLAlchemy)
  ├── DROP all foreign key constraints
  ├── TRUNCATE cde.datasets, cde.profiles, cde.variables, cde.organizations, cde.points
  │
  ├── COPY datasets.csv   → cde.datasets_staging
  ├── COPY profiles.csv   → cde.profiles_staging
  ├── COPY variables.csv  → cde.variables_staging
  ├── COPY ckan.csv       → cde.ckan_staging
  │
  ├── execute SQL: profile_process()
  │     → deduplicates, links profiles to datasets
  ├── execute SQL: ckan_process()
  │     → upserts organizations, links to datasets
  ├── execute SQL: create_hexes()
  │     → builds hexes_zoom_0 and hexes_zoom_1 spatial aggregations
  └── execute SQL: set_constraints()
        → re-adds foreign key constraints
```

#### Incremental Mode (`--incremental` / `INCREMENTAL_MODE=true`)

```
cde_db_loader/__main__.py
  │
  ├── COPY CSVs → temporary staging tables
  ├── UPSERT from staging → live tables (ON CONFLICT DO UPDATE)
  ├── DELETE rows present in live tables but absent from staging
  │     (these are datasets that disappeared from ERDDAP servers)
  └── execute SQL: profile_process(), ckan_process(), create_hexes()
```

---

## Workflow B — User Data Discovery (Runtime API)

### Step-by-step

```
1. Browser loads frontend (served by Nginx)
2. React app initialises:
   ├── GET /api/oceanVariables  → loads EOV filter options
   ├── GET /api/organizations   → loads org filter options
   └── GET /api/platforms       → loads platform filter options

3. User draws polygon on Mapbox map
4. User selects time range, EOVs, platforms

5. Frontend requests tile data:
   GET /api/tiles?zoom=N&polygon=WKT&...
     └── web-api routes/tiles.js
           └── Knex query → PostGIS ST_Intersects on hexes_zoom_N
               → returns GeoJSON hexagons with dataset counts

6. Frontend requests dataset list:
   GET /api/datasets?polygon=WKT&startDate=...&endDate=...&eov=...
     └── web-api routes/datasets.js
           └── Knex query → cde.datasets JOIN cde.profiles
               → filter by spatial, temporal, EOV
               → returns paginated JSON

7. Results displayed in table and map
```

---

## Workflow C — User Data Download

### Step-by-step

```
1. User selects datasets + clicks Download
2. Frontend:
   GET /api/downloadEstimate?...   → check size before committing
   POST /api/download              → { polygon, startDate, endDate, email, datasets }
     └── web-api routes/download.js
           └── INSERT INTO cde.download_jobs (status='open', query_params)
               → returns job_id

3. download_scheduler polling loop (runs every N seconds):
   download_scheduler.py
     ├── SELECT * FROM cde.download_jobs WHERE status='open'
     │     FOR UPDATE SKIP LOCKED   (safe for multiple scheduler replicas)
     ├── UPDATE status = 'in_progress'
     │
     ├── downloader_wrapper.run_download_query(job)
     │     │
     │     ├── create temp directory
     │     ├── download_erddap.run(query_params)
     │     │     ├── for each dataset_id in job:
     │     │     │     ├── build ERDDAP tabledap URL with time/bbox constraints
     │     │     │     ├── GET /erddap/tabledap/{id}.csv (streaming)
     │     │     │     ├── if polygon (not just bbox): filter rows with Shapely
     │     │     │     ├── check size limits (1GB/dataset, 5GB/total)
     │     │     │     └── write to temp/{dataset_id}.csv
     │     │     └── return file list + metadata
     │     │
     │     ├── zip all files → downloads/{job_id}.zip
     │     └── cleanup temp dir
     │
     ├── UPDATE cde.download_jobs SET status='completed', download_url=...
     │
     └── download_email.send(user_email, download_url)
           └── Gmail SMTP → HTML email with link

4. User receives email with download link
   → Nginx serves /downloads/{job_id}.zip from named volume
```

---

## Execution Tree

```
run.sh
├── cde_harvester.__main__
│   └── prefect_pipeline.run_harvest [Prefect @flow]
│       ├── erddap_harvester.harvest_erddap (×N servers) [Prefect @task]
│       │   └── ERDDAPHarvester.harvest()
│       │       ├── ERDDAP.get_dataset_list
│       │       ├── dataset.Dataset (×M datasets)
│       │       │   ├── ERDDAP.get_metadata
│       │       │   ├── CDEComplianceChecker.passes_all_checks
│       │       │   └── profiles.get_profiles
│       │       └── returns HarvestResult
│       ├── obis_harvester.harvest_obis [Prefect @task]
│       │   └── OBISHarvester.harvest()
│       └── [results → db_loader]
│
└── cde_db_loader.__main__
    ├── db_loader.full_reload      (or incremental_db_loader)
    │   ├── COPY CSV files
    │   └── SQL: profile_process, ckan_process, create_hexes, set_constraints
    └── [exit]

web-api/app.js (always-on)
└── routes/: datasets, tiles, download, organizations, ...
    └── db.js (Knex) → PostgreSQL

download_scheduler.__main__ (always-on polling loop)
└── download_scheduler.run_pending_jobs
    ├── downloader_wrapper.run_download_query
    │   └── download_erddap.run
    └── download_email.send
```

---

## Runtime Lifecycle Notes

- **Harvester** is stateless; safe to re-run. Uses disk-cache to avoid re-fetching unchanged ERDDAP metadata.
- **DB Loader** is idempotent in full-reload mode. Incremental mode tracks deletions via set-difference between staging and live tables.
- **Download Scheduler** uses `FOR UPDATE SKIP LOCKED` so multiple replicas never double-process a job.
- **Web API** is stateless; Redis cache is invalidated by TTL, not events (cache drift is acceptable since data is updated nightly).
