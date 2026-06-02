# External Integrations

## Integration Inventory

---

### 1. ERDDAP Servers

**Purpose:** Primary data source. All ocean science datasets live on ERDDAP servers operated by various Canadian institutions.

**Files Involved:**
- `harvester/cde_harvester/ERDDAP.py` — HTTP client
- `harvester/cde_harvester/harvest_erddap.py` — discovery orchestration
- `downloader/erddap_downloader/download_erddap.py` — data download
- `harvester/cioos_erddap_servers.csv` — list of known server URLs

**Authentication:** None (public read-only endpoints)

**Data Exchanged:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/erddap/tabledap/allDatasets.csv` | GET | List all dataset IDs on a server |
| `/erddap/info/{dataset_id}/index.csv` | GET | Dataset metadata (globals, variables, attributes) |
| `/erddap/tabledap/{dataset_id}.csv?{query}` | GET | Profile IDs, stats, or actual data rows |

**Caching:** `diskcache` (Python) caches ERDDAP metadata responses on disk. Toggle via `cache: true` in `harvest_config.yaml`. Prevents hammering servers on repeated test runs.

**Known Servers (from `cioos_erddap_servers.csv`):**
- CIOOS Pacific ERDDAP
- CIOOS Atlantic ERDDAP
- CIOOS St. Lawrence ERDDAP
- Other institutional ERDDAP servers listed in the CSV

---

### 2. CKAN

**Purpose:** Provides organizational/publisher metadata (organization name, logo URL, description, color) for datasets discovered during harvest.

**Files Involved:**
- `harvester/cde_harvester/utils.py` — `get_ckan_record()` function

**Authentication:** None (public CKAN API)

**Data Exchanged:**
- Input: dataset global attribute `publisher_name` or `institution`
- Output: organization record (name, title, image_url, color, description)

**Endpoint:** CKAN action API — `GET /api/3/action/organization_show?id={org_name}`

**Error Handling:** If CKAN lookup fails, the dataset is still harvested with empty organization data.

---

### 3. PostgreSQL 13 + PostGIS 3.1

**Purpose:** Central data store for all harvested metadata, spatial aggregations, and download job queue.

**Files Involved:**
- `database/1_schema.sql` — schema definition
- `database/2_functions.sql` — SQL processing functions
- `db-loader/cde_db_loader/` — load logic
- `web-api/db.js` — Knex connection pool
- `download_scheduler/download_scheduler.py` — job polling

**Authentication:** Username/password via environment variables (`DB_USER`, `DB_PASSWORD`)

**Connection Details:**
- Default port: 5432
- Schema: `cde`
- Harvester uses `DB_HOST_EXTERNAL` (bypasses Docker network)
- All other services use `DB_HOST` (internal Docker DNS)

**Key Tables:**

| Table | Row Count Estimate | Description |
|-------|--------------------|-------------|
| `cde.datasets` | ~500–2000 | One row per ERDDAP dataset |
| `cde.profiles` | ~10k–100k | One row per profile/timeseries |
| `cde.variables` | ~5k–20k | One row per variable per dataset |
| `cde.organizations` | ~50 | CKAN organization records |
| `cde.points` | ~50k–500k | Unique lat/lon pairs |
| `cde.hexes_zoom_0` | ~1k | Low-zoom hexagon tiles |
| `cde.hexes_zoom_1` | ~10k | High-zoom hexagon tiles |
| `cde.download_jobs` | growing | User download job queue |

---

### 4. Redis

**Purpose:** API response cache to reduce database load.

**Files Involved:**
- `web-api/cache.js` — cache setup
- `web-api/routes/*.js` — cache middleware wrapping route handlers

**Authentication:** None (private Docker network, no password in dev)

**Cache Strategy:**
- TTL: 5 minutes (approximate; configurable)
- Key: hash of full request URL + query params
- Invalidation: TTL expiry only (no event-driven invalidation)
- Production only: not used in development (`REDIS_HOST` env var controls activation)

---

### 5. Gmail SMTP

**Purpose:** Delivers download completion emails to users.

**Files Involved:**
- `download_scheduler/download_email.py`
- `download_scheduler/templates/` — Jinja2 HTML email templates

**Authentication:** Gmail app password via `GMAIL_USER` / `GMAIL_PASSWORD` environment variables

**Data Exchanged:**
- To: user email address (from download job)
- Subject: "Your CIOOS download is ready"
- Body: HTML email with download link and dataset summary

**Optional:** If `GMAIL_USER` is not set, email sending is skipped (job still completes).

---

### 6. MMISW Ontology (ioos.us)

**Purpose:** Platform vocabulary — maps IOOS platform codes to NERC L06 codes used for platform-type filtering.

**Files Involved:**
- `harvester/cde_harvester/platform_ioos_to_l06.py`

**Authentication:** None (public)

**Endpoint:** `https://mmisw.org/ont/api/v0/mapping?...`

**Caching:** Downloaded mapping is cached as a CSV file locally. If download fails, falls back to the cached CSV.

---

### 7. Sentry

**Purpose:** Error and exception tracking in production.

**Files Involved:**
- `harvester/cde_harvester/__main__.py` — `sentry_sdk.init()`
- `download_scheduler/__main__.py` — `sentry_sdk.init()`
- `web-api/app.js` — Sentry Express middleware

**Authentication:** DSN token via `SENTRY_DSN` environment variable

**Data Exchanged:** Unhandled exceptions + stack traces → Sentry cloud

---

### 8. Nginx

**Purpose:** Reverse proxy routing traffic to web-api, serving the frontend SPA, and serving completed download ZIP files.

**Files Involved:**
- `nginx/nginx.conf` — routing configuration
- `docker-compose.yaml` / `docker-compose.production.yaml` — volume mounts

**Routing:**
- `/api/*` → web-api (upstream, load-balanced in production)
- `/downloads/*` → named volume (`downloads`) containing ZIP files
- `/*` → frontend static assets

---

### 9. Docker / Docker Compose

**Purpose:** Service orchestration for all components.

**Files Involved:**
- `docker-compose.yaml` — development
- `docker-compose.production.yaml` — production

**Named Volumes:**
- `db-data` — PostgreSQL data directory
- `downloads` — completed ZIP files (shared between scheduler and nginx)
- `cache` — harvester disk cache
- `logs` — harvester logs

---

### 10. 1Password (Production Secrets)

**Purpose:** Secrets management for production `.env` files.

**Files Involved:**
- `.env.production` — contains `op://vault/item/field` references

**Pattern:** `op run --env-file .env.production -- docker compose up`

The `op` CLI resolves secrets at container startup; no plaintext credentials are stored in the repo.
