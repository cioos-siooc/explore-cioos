# Technical Debt Assessment

---

## High Risk

### 1. No Integration Tests for ETL Pipeline

**Location:** `harvester/`, `db-loader/`

The harvest → load pipeline has no automated tests verifying the full cycle end-to-end. The compliance checker and profile extraction logic are tested only manually (or by running against live ERDDAP servers). A regression in `CDEComplianceChecker.py` or `profiles.py` could silently discard large numbers of datasets.

**Risk:** Silent data quality regression on any code change.

**Mitigation needed:** Fixture-based unit tests with recorded ERDDAP API responses.

---

### 2. Download Scheduler Has No Retry Logic

**Location:** `download_scheduler/download_scheduler.py`

If a download job fails due to a transient ERDDAP timeout or network error, the job is marked `failed` immediately with no retry. Users must re-submit their request manually.

**Risk:** Poor user experience; transient failures appear as permanent.

**Mitigation needed:** Retry counter column in `download_jobs`, exponential backoff.

---

### 3. Full Reload Drops All Constraints Mid-Load

**Location:** `db-loader/cde_db_loader/db_loader.py`

The full-reload path drops foreign key constraints before loading, leaving the database in an unconstrained state during the entire load window. If the process crashes mid-load, the database is left with orphaned rows and no constraints.

**Risk:** Data integrity loss if load is interrupted; no atomic transaction wrapper.

**Mitigation needed:** Wrap full reload in a transaction, or always use incremental mode in production.

---

### 4. Platform Vocabulary Download Is Best-Effort

**Location:** `harvester/cde_harvester/platform_ioos_to_l06.py`

IOOS → NERC L06 mapping is downloaded from the MMISW ontology server at harvest time. If the server is down, it silently falls back to a cached CSV. If the cache is also stale, datasets may be tagged with incorrect or missing platform codes.

**Risk:** Silent data quality issues for platform filtering.

---

## Medium Risk

### 5. Redis Cache Has No Invalidation Mechanism

**Location:** `web-api/cache.js`, all route handlers

Cache entries expire by TTL only. After a nightly DB load, the API continues serving stale data from Redis for up to 5 minutes. In production, a full reload takes ~10–30 minutes during which old data is shown.

**Mitigation needed:** Cache flush triggered by db-loader on completion, or shorter TTL.

---

### 6. Download Size Limits Are Checked After Downloading

**Location:** `downloader/erddap_downloader/download_erddap.py`

The 1GB-per-dataset and 5GB-total limits are checked after the data has already been streamed from ERDDAP. For large datasets this means downloading gigabytes only to discard them.

**Note:** `/downloadEstimate` exists to pre-check size, but it is called by the frontend as advisory only — a user can bypass it.

**Mitigation needed:** Enforce estimate check server-side before inserting the download job, or implement streaming size check with early abort.

---

### 7. Harvester Thread Pool Has No Backpressure

**Location:** `harvester/cde_harvester/__main__.py`

All ERDDAP server URLs are submitted to the thread pool immediately. If the pool is processing a slow server, tasks for other servers queue up in memory. For very large server lists this could consume significant memory.

**Mitigation needed:** Bounded queue with backpressure, or sequential per-server processing with async I/O.

---

### 8. CKAN Lookup Is Synchronous and Unbounded

**Location:** `harvester/cde_harvester/utils.py`

For each dataset, a synchronous HTTP request is made to CKAN. There is no connection pool, timeout, or circuit breaker. A slow CKAN response blocks the harvest thread for that dataset indefinitely.

**Mitigation needed:** Set request timeout, cache CKAN responses, or batch-fetch organizations.

---

### 9. Hardcoded SQL in db-loader

**Location:** `db-loader/cde_db_loader/db_loader.py`, `incremental_db_loader.py`

Table names, schema names, and column lists are hardcoded as string literals. Changes to the database schema require coordinated updates in multiple Python files with no compile-time checking.

**Mitigation needed:** Schema migration tool (e.g., Alembic), or at minimum extract table/column names to constants.

---

### 10. No Health Checks on Services

**Location:** `docker-compose.yaml`, `docker-compose.production.yaml`

The download scheduler and harvester have no liveness/readiness probes. A crashed scheduler is invisible until a user notices their download never arrived.

**Mitigation needed:** Heartbeat table updated by scheduler; alerting on stale heartbeat.

---

## Low Risk

### 11. Frontend Has No End-to-End Tests

**Location:** `frontend/`

No Playwright/Cypress tests cover the critical user path (draw polygon → filter → download). Changes to Map.js or Filter.jsx could silently break the UX.

---

### 12. Inconsistent Error Logging

**Location:** All Python modules

Some modules use `loguru`, some use the standard `logging` module, and some use bare `print()` statements. Log aggregation is inconsistent.

---

### 13. `cioos_erddap_servers.csv` Is Manually Maintained

**Location:** `harvester/cioos_erddap_servers.csv`

Adding a new ERDDAP server requires a manual git commit. No admin interface or automated discovery exists.

---

### 14. i18n Strings Are Partially Complete

**Location:** `frontend/src/locales/`

Some French translations are missing or fall back to English strings. No CI check enforces translation completeness.

---

### 15. `harvest_config.yaml` Is Not Validated on Load

**Location:** `harvester/cde_harvester/__main__.py`

The YAML config is loaded with `yaml.safe_load()` and accessed by key without schema validation. A typo in the config (e.g., `max_workers` instead of `max-workers`) silently uses a default or raises a confusing `KeyError`.

**Mitigation needed:** Pydantic or `cerberus` schema validation on startup.
