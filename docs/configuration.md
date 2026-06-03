# Configuration

## Configuration Sources

The system uses three configuration mechanisms:

1. **Environment variables** — runtime secrets and deployment settings (`.env` files loaded by Docker Compose)
2. **YAML file** — harvester-specific settings (`harvest_config.yaml`)
3. **CSV files** — static reference data (ERDDAP server list, platform mappings)

---

## Configuration Loading Sequence

```
Docker Compose startup
  └── loads .env (or .env.production via op run)
        → injects env vars into each container

Harvester startup
  └── reads harvest_config.yaml (path from -f CLI arg)
        → erddap_urls, dataset_ids, cache, max-workers, folder, log_dir

DB Loader startup
  └── reads env vars: DB_NAME, DB_USER, DB_PASSWORD, DB_HOST, DB_PORT
  └── reads CLI args: --folder, --incremental

Web API startup
  └── reads env vars: DB_*, REDIS_HOST, CORS_ORIGINS, SENTRY_DSN, etc.

Download Scheduler startup
  └── reads env vars: DB_*, GMAIL_USER, GMAIL_PASSWORD, DOWNLOAD_WAF_URL, etc.
```

---

## Environment Variable Matrix

### Database

| Variable | Purpose | Required | Default |
|----------|---------|----------|---------|
| `DB_NAME` | PostgreSQL database name | Yes | — |
| `DB_USER` | PostgreSQL username | Yes | — |
| `DB_PASSWORD` | PostgreSQL password | Yes | — |
| `DB_HOST` | PostgreSQL host (internal Docker) | Yes | `db` |
| `DB_PORT` | PostgreSQL port | No | `5432` |
| `DB_HOST_EXTERNAL` | PostgreSQL host from outside Docker (harvester) | Yes (harvester) | — |

### API

| Variable | Purpose | Required | Default |
|----------|---------|----------|---------|
| `API_URL` | Base URL for API (used by frontend) | Yes | — |
| `BASE_URL` | Base URL for download links in emails | Yes | — |
| `CORS_ORIGINS` | Comma-separated allowed origins | Yes | — |
| `ENABLE_API_DOCS` | Enable Swagger UI at `/api-docs` | No | `false` |
| `PORT` | API server port | No | `3000` |

### Caching

| Variable | Purpose | Required | Default |
|----------|---------|----------|---------|
| `REDIS_HOST` | Redis hostname | No (dev can omit) | — |
| `REDIS_PORT` | Redis port | No | `6379` |

### Downloader / Scheduler

| Variable | Purpose | Required | Default |
|----------|---------|----------|---------|
| `DOWNLOAD_WAF_URL` | Base URL served by Nginx for download files | Yes | — |
| `CREATE_PDF` | Whether to attempt PDF download alongside data | No | `false` |
| `DOWNLOAD_POLL_INTERVAL` | Seconds between job queue polls | No | `30` |
| `INCREMENTAL_MODE` | Use incremental DB load (faster, for nightly runs) | No | `false` |

### Email

| Variable | Purpose | Required | Default |
|----------|---------|----------|---------|
| `GMAIL_USER` | Gmail sender address | No | — |
| `GMAIL_PASSWORD` | Gmail app password | No | — |

### Monitoring

| Variable | Purpose | Required | Default |
|----------|---------|----------|---------|
| `SENTRY_DSN` | Sentry project DSN for error reporting | No | — |
| `ENVIRONMENT` | Environment label sent to Sentry (`production`, `staging`) | No | — |
| `HARVESTER_LOG_DIR` | Directory for harvester log files | No | `/logs` |

---

## Harvester YAML Configuration (`harvest_config.yaml`)

```yaml
# List of ERDDAP server base URLs to harvest
erddap_urls:
  - https://data.cioospacific.ca/erddap
  - https://catalogue.ogsl.ca/erddap
  - ...

# Optional: restrict to specific dataset IDs (for testing)
dataset_ids:
  - my_dataset_id_1

# Use disk cache to avoid re-fetching unchanged metadata
cache: true

# Output directory for CSV files
folder: harvest

# Number of parallel worker threads per server
max-workers: 4

# Log file directory
log_dir: /logs
```

**Location:** Mounted as a Docker volume; default path `/harvest_config.yaml` inside container.

---

## ERDDAP Server List (`harvester/cioos_erddap_servers.csv`)

A CSV listing all ERDDAP servers to harvest. Columns:
- `url` — base URL of the ERDDAP server
- `name` — human-readable institution name
- `active` — whether to include in harvests

This file is tracked in git and updated manually when new servers are added.

---

## EOV Mapping Files

| File | Location | Purpose |
|------|----------|---------|
| `cde_to_goos_eov.json` | `harvester/cde_harvester/` | Maps CDE internal EOV names to GOOS standard names |
| `goos_eov_to_standard_name.json` | `harvester/cde_harvester/` | Maps GOOS EOV names to CF standard variable names |

These are static reference files maintained in version control. They define which ocean variables (EOVs) the platform supports.

---

## Docker Compose Environment Injection

Development (`.env` file):
```
DB_NAME=cioos
DB_USER=cioos
DB_PASSWORD=cioos
DB_HOST=db
...
```

Production (`.env.production` with 1Password references):
```
DB_PASSWORD=op://Production/postgres/password
GMAIL_PASSWORD=op://Production/gmail/app-password
SENTRY_DSN=op://Production/sentry/dsn
...
```

Resolved at startup via: `op run --env-file .env.production -- docker compose -f docker-compose.production.yaml up`
