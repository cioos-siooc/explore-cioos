# CDE - CIOOS Exploration and Data Discovery

[![Test](https://github.com/cioos-siooc/explore-cioos/actions/workflows/build_and_test.yml/badge.svg)](https://github.com/cioos-siooc/explore-cioos/actions/workflows/build_and_test.yml)
[![Deploy](https://github.com/cioos-siooc/explore-cioos/actions/workflows/deploy.yml/badge.svg)](https://github.com/cioos-siooc/explore-cioos/actions/workflows/deploy.yml)
[![Last Harvest](https://github.com/cioos-siooc/explore-cioos/actions/workflows/harvest.yml/badge.svg)](https://github.com/cioos-siooc/explore-cioos/actions/workflows/harvest.yml)

## Testing a dataset

If you just want to see how a dataset is harvested by CDE:

1. Install [uv](https://github.com/astral-sh/uv)
2. `cd harvester`
3. `uv run python -m cde_harvester --urls https://data.cioospacific.ca/erddap --dataset_ids ECCC_MSC_BUOYS`
4. See files in `harvest` folder

## Starting using docker

1. Install [Docker](https://docs.docker.com/get-docker/) and [Docker compose](https://docs.docker.com/compose/install/). New versions of Docker include `docker compose`
2. Rename file `.env.sample` to `.env` and change any settings if needed. If you are running on your local machine these settings don't need to change
3. Copy `harvest_config.sample.yaml` to `harvest_config.yaml` and modify if needed. This step is required — the config is not baked into the image, and the worker refuses to start without one (see [Harvest configuration](#harvest-configuration)).
4. Copy `docker-compose.override.yaml.sample` to `docker-compose.override.yaml`. The base `docker-compose.yaml` publishes **no** host ports (so it can be deployed as-is behind a proxy such as Coolify); the override publishes nginx and Prefect locally. Ports are configurable via `NGINX_PORT` (default 8098) and `PREFECT_PORT` (default 4200) in `.env`.
5. Run locally with docker compose:
    1. Development environment: `docker compose up -d`
    2. Production configuration: `docker compose -f docker-compose.yaml -f docker-compose.production.yaml up -d` — `docker-compose.production.yaml` is an **overlay**, not a standalone stack (see [Production deployment](#production-deployment)).
6. See website at <http://localhost:8098>
7. See Prefect Dashboard at <http://localhost:4200> (Manage flows and deployments)

### Data Harvesting with Prefect

The harvester is now orchestrated by Prefect. The Docker Compose stack includes:
- **Prefect Server** (`prefect`): Manage flows, view logs, and trigger runs.
- **Prefect Worker** (`prefect_worker`): Runs harvest flows **in-process** on a `process` work pool (no per-run containers).

The worker registers the work pool and all deployments automatically on startup
(`REGISTER_DEPLOYMENTS=true`), so a plain `docker compose up -d` is enough — no
separate deploy step. To (re)register after a config change, restart the worker:
```bash
docker compose up -d prefect_worker
```
*Note: Set `INCREMENTAL_MODE=true` in your `.env` to make the deployment default to incremental harvesting (faster, only updates changed datasets).*

#### Downloads in Prefect

Downloads are queued in `cde.download_jobs` by the web API and consumed by the
`scheduler` service, which is a plain polling worker — **not** a Prefect
deployment, and it does not run on the `cde-process-pool`. Keeping it in its own
container is deliberate: the pool's workers share a memory budget sized for
harvests, and a download (OBIS parquet through DuckDB, multi-hundred-MB CSVs) is
heavy enough that co-scheduling the two risks starving both. It also means a
harvester crash or restart cannot take the download queue's only consumer with
it.

Each job is still *reported* to Prefect, so the queue is observable in the same
UI as the harvests. `run_download_observed` wraps every job in a flow run under
the flow **`Download Job`**, named `download-<job_id>`, and mirrors the
scheduler's loguru output into that run's logs. Run state reflects the outcome:
a job finishing `failed` is a failed run; `completed`, `no-data` and
`over-limit` are all successes, since those are results the user is emailed
about rather than faults.

This is controlled by `PREFECT_API_URL`, which compose sets on the `scheduler`
service (hardcoded to `http://prefect:4200/api`, not interpolated from `.env` —
that var holds `localhost:4200` for host-side CLI use, which inside the
container points at the container itself). Remove the line and the queue still
drains exactly as before — jobs simply stop appearing in Prefect. That is also
why it is off by default outside compose: with no server to talk to, Prefect
would record runs into its own ephemeral store where nobody would look.

#### Harvest configuration

The harvest config (`harvest_config.yaml`) is **not baked into the image** — it
is provided at runtime, so config changes never require an image rebuild. The
worker resolves it in priority order (both when registering deployments at
startup and again at the start of every flow run):

1. **`HARVEST_CONFIG_B64`** env var — the *whole YAML file, base64-encoded on
   one line*. This is the channel to use under Coolify; generate it with
   `base64 < harvest_config.yaml | tr -d '\n'`. A value that fails to decode
   (or decodes to something that isn't a YAML mapping) aborts startup — it
   never silently falls back to a stale mounted config.
2. **`HARVEST_CONFIG_YAML`** env var — the *raw YAML text*. **Deprecated**,
   kept for deployments already using it: multi-line values do not survive
   Coolify's env editor intact, which is the corruption `HARVEST_CONFIG_B64`
   exists to avoid. Use it and you get a warning in the worker log.
3. **`HARVEST_CONFIG_FILE`** env var — path to a config file mounted into the
   container (set to `/app/harvester/harvest_config.yaml` in the compose files).
4. A file mounted at `/app/harvester/harvest_config.yaml` — locally via
   `docker-compose.override.yaml`, in production via the bind mount in
   `docker-compose.production.yaml`.

If none is found, the worker **refuses to start** with a message listing these
options — there is no baked fallback, so a misconfigured deploy fails loudly
instead of silently harvesting the sample servers.

**Updating the config on a running deployment:**

| What changed | What's needed |
|---|---|
| Values in the mounted file (`cache`, `incremental`, `dataset_ids`, …) | Nothing — the next flow run re-reads the file |
| `erddap_urls`, or turning OBIS on/off (`obis_discovery.enabled`) | `docker compose restart prefect_worker` — startup re-registers the per-source deployments |
| Which OBIS datasets are harvested | Nothing — `obis_discovery` re-queries the OBIS API on every OBIS harvest, so new Canadian datasets are picked up automatically |
| Anything set via env (`HARVEST_CONFIG_B64`/`HARVEST_CONFIG_YAML`, `HARVESTER_CRON`, `.env` values) | `docker compose up -d --force-recreate prefect_worker` — a plain `restart` reuses the old container **and its old environment** (on Coolify: redeploy the resource) |

Remote workers (`docker-compose.worker.yaml`) execute flows too, so they need
the *same* config as the primary stack — via `HARVEST_CONFIG_B64` in their
`.env` or a local file mount (see the comments in that compose file).

This will register the flow with the Prefect server. You can then trigger runs from the UI or let the schedule take over.

To manually trigger a run:
1. Go to <http://localhost:4200>
2. Find the **cde-harvester-deployment**
3. Click **Run** -> **Quick Run**

For more details, see:
- [Harvester Usage Guide](harvester/README.md)
- [DB Loader README](db-loader/README.md)

## Front End Development

There are two main approaches for frontend development:

### Option 1: Frontend Local + Backend via Docker Compose

Run the frontend locally while using Docker Compose for all backend services (recommended for full-stack development).

1. Rename `.env.sample` from the root directory to `.env` and change any settings if needed. If you are running on your local machine, these settings don't need to change.

2. Start all backend services using Docker Compose:

   ```sh
   docker compose up -d
   ```

3. Start the frontend locally:

   ```sh
   cd frontend
   npm install
   npm start
   ```

4. See website at <http://localhost:8000>

### Option 2: Frontend Local + Remote API

Run only the frontend locally and connect to a remote API (recommended for frontend-only development).

1. Start the frontend with a custom API URL:

   ```sh
   cd frontend
   npm install
   REACT_APP_API_URL=https://your-remote-api.com/api npm start
   ```

2. See website at <http://localhost:8000>

### Full Local Development Setup

For complete local development with all services running outside Docker (advanced):

1. Rename `.env.sample` from the root directory to `.env` and change any settings if needed.

2. Start a local database and prefect server using `docker`:

   ```sh
   docker compose up -d db prefect
   ```
   *Alternatively*, you can run the prefect server manually in a separate terminal:
   ```sh
   uv run prefect server start
   ```

3. Setup Python virtual env and install Python modules using uv (recommended):

   ```sh
   # Install uv if needed
   # pip install uv

   # Harvester
   cd harvester
   uv sync
   
   # Download Scheduler
   cd ../download_scheduler
   uv sync
   ```

4. Start the API:

   ```sh
   cd web-api
   npm install
   npm start
   ```

5. Start the download scheduler:

   ```sh
   python -m download_scheduler
   ```

   Export `PREFECT_API_URL=http://localhost:4200/api` first if you want each
   download to show up as a flow run in the Prefect dashboard — see
   [Downloads in Prefect](#downloads-in-prefect).

6. Start the frontend:

   ```sh
   cd frontend
   npm install
   npm start
   ```

7. Harvest a single dataset and load CKAN data:

   ```sh
   sh data_loader_test.sh
   ```

8. See website at <http://localhost:8000>

## CI/CD

Pushes to `master` and `development` automatically deploy to the corresponding environment via the [Deploy workflow](.github/workflows/deploy.yml). The workflow connects to the remote server over WireGuard VPN, syncs the repository to the exact commit that triggered the run, injects secrets from 1Password, and brings up the Docker Compose stack.

## Deploying with Coolify (dev/staging)

Coolify routes traffic through its own proxy over the docker network, so no host
ports must be published. Create a **Docker Compose** resource pointing at
`docker-compose.yaml` — that file publishes no host ports and already carries
the Coolify "magic" variables:

- `SERVICE_FQDN_NGINX_4000` (on `nginx`): Coolify generates a public FQDN and
  proxies it to nginx's container port 4000.
- `SERVICE_URL_NGINX`: injected by Coolify and used as the scheduler's
  `DOWNLOAD_WAF_URL` base (falls back to `APP_DOMAIN` outside Coolify).

Coolify ignores `docker-compose.override.yaml` (and only supports a single
compose file per resource), so local-dev port publishing never leaks into a
Coolify deploy.

**Harvest config under Coolify:** relative bind mounts of repo files don't work
under Coolify (the source resolves to an empty persistent-storage dir), and the
image no longer bakes a config (the old `BAKED_HARVEST_CONFIG` build variable
is gone). Provide the config one of two ways:

- Set the **`HARVEST_CONFIG_B64`** env var on the resource to the whole YAML
  file, base64-encoded onto a single line:

  ```sh
  base64 < harvest_config.production.yaml | tr -d '\n'
  ```

  Paste that one line as the value, then **redeploy** the resource (a restart
  reuses the old environment). To check what a deployed value holds, run
  `echo "$HARVEST_CONFIG_B64" | base64 -d`.

  Do *not* paste raw multi-line YAML into an env var. Coolify's env editor
  reindents continuation lines and mangles `#` comments on the way to the
  generated `.env`, so the config arrives corrupted — which is exactly why this
  value is base64. To edit the config, change the YAML file in the repo and
  re-encode it. (`HARVEST_CONFIG_YAML` still accepts raw YAML for existing
  deployments, but it is deprecated for precisely this reason.)

- Or, if you want the config to stay human-editable in the Coolify UI, add a
  **Persistent Storage file mount** onto `/app/harvester/harvest_config.yaml`
  and paste the YAML there instead. `HARVEST_CONFIG_FILE` already points at that
  path in `docker-compose.yaml`. (Note this is a Coolify-managed *file* mount —
  a relative bind mount of a repo file in the compose file does not work.)

Without one of these the `prefect_worker` container exits at startup with a
message explaining the options.

## Production deployment

Deploy CDE to production using Docker Compose with the production configuration
file (no Coolify). Published host ports are configurable via `.env`:
`NGINX_PORT` (default 8098), `PREFECT_PORT` (default 4200) and `DB_PORT`
(default 5432 — also sets Postgres' internal `PGPORT`).

### Compose file layout

`docker-compose.production.yaml` is an **overlay**: it contains only what
self-hosted production *adds* to `docker-compose.yaml`, so the whole
production-vs-everything-else diff is that one short file. Deploy both:

```sh
docker compose -f docker-compose.yaml -f docker-compose.production.yaml up -d --build
```

One setting in `.env` makes that the default for every command run on the box
(docker compose reads `COMPOSE_*` from `.env`), so ad-hoc `docker compose logs` /
`ps` / `restart` on the server pick up the same pair — it is already in
`.env.production`:

```sh
COMPOSE_FILE=docker-compose.yaml:docker-compose.production.yaml
```

No `COMPOSE_PROFILES` is needed, and no service is profile-gated. `scheduler`
used to sit behind a `tools` profile, which made starting the download-queue
consumer opt-in: any deployment that forgot the env var — Coolify never sets it —
came up with no consumer and left every download `open` forever. It is now an
ordinary service.

What the overlay adds, and nothing else: host ports (nginx, Prefect, Postgres),
the externally-managed `explore-cioos_default` network, the host-editable
`harvest_config.yaml` bind mount, the capped redis config, and the two env vars
whose base values assume Coolify (`DOWNLOAD_WAF_URL`, `DB_HOST_EXTERNAL`).
Everything else — images, healthchecks, named volumes, harvester memory limits —
is inherited from `docker-compose.yaml`, so it only has to be maintained once.

### Initial Setup

0. Create the shared network once, if it does not already exist on the host:

   ```sh
   docker network create explore-cioos_default
   ```

1. Rename `.env.sample` to `.env` and configure with production settings (docker compose only auto-loads `.env`). The deploy workflow renders these from `.env.production` via 1Password.

2. Copy `harvest_config.sample.yaml` to `harvest_config.yaml` and configure the datasets to harvest. The file is bind-mounted into the worker (not baked into the image), so it can be edited on the host at any time — see [Harvest configuration](#harvest-configuration) for how changes are picked up.

3. Delete old redis and postgres data (if needed):

   ```sh
   sudo docker volume rm cde_postgres-data cde_redis-data
   ```

4. Start all services using the base file plus the production overlay:

   ```sh
   sudo docker compose -f docker-compose.yaml -f docker-compose.production.yaml up -d --build
   ```

   With `COMPOSE_FILE` set in `.env` (above), plain
   `sudo docker compose up -d --build` is equivalent.

### Data Harvesting (Production)

The harvester runs on a Prefect **`process` work pool**: the `prefect_worker`
container runs harvest flows **in-process** (no per-run containers, no docker
socket). Since we use Prefect for orchestration, you don't need a system cron job.

1. Start the Prefect server and worker:
   ```sh
   docker compose up -d prefect prefect_worker
   ```
   On startup the worker registers the `cde-process-pool` work pool and all
   deployments (full harvest, per-source, vernaculars), then begins polling.

   > The Prefect server stores its metadata in **Postgres** (a dedicated
   > `prefect` database in the shared `db` service, auto-created on startup),
   > not SQLite — SQLite locks under the concurrent access from scaled / remote
   > workers. This is why `prefect` depends on `db`.

2. Control *when* harvests run via `.env` (all optional):
   - `HARVESTER_CRON` / `VERNACULARS_CRON` — recurring schedules (unset = none).
   - `RUN_ON_DEPLOY=true` — fire one full harvest immediately on (re)deploy.
   - Manual / per-source — trigger from the Prefect UI or the dashboard
     "Trigger harvest" button at any time.

   *Note: single-source runs always force **Incremental Mode** so they can't
   TRUNCATE the other sources. Full runs honor `INCREMENTAL_MODE`.*

2b. **Rebuilding the schema after a table-layout change.** Postgres applies
   `database/1_schema.sql` only when it initialises a *fresh* data volume, and
   `db_migrate` re-applies only the `[3-9]_*.sql` function files — whose table
   references all sit inside PL/pgSQL bodies and so are not checked at load time.
   A deploy that adds or renames a table therefore reports a clean migration while
   leaving the database on the old layout; the mismatch first shows up as
   `relation "cde.<table>" does not exist` at query time.

   The `Rebuild Database` deployment (`cde-rebuild-database`) fixes that in place —
   no volume deletion and no host shell:

   ```sh
   docker exec <prefect_worker> sh -c "cd /app/harvester && uv run prefect deployment run \
     'Rebuild Database/cde-rebuild-database' -p confirm=$DB_NAME"
   ```

   It drops the `cde` schema, re-applies `1_schema.sql` and the `[3-9]` files in one
   transaction (a mid-way failure rolls back rather than half-migrating), flushes the
   redis tile cache, and triggers `Harvest All Sources` to repopulate.

   Requires `DB_NAME`/`DB_USER`/`DB_PASSWORD` on the deployment — Coolify supplies none
   of them (see `.env.coolify.sample`). The worker now refuses to start without them
   rather than registering deployments that fail at connection time inside every run.

   **This destroys all harvested data**, exactly as deleting the Postgres volume would.
   `confirm` must equal `DB_NAME` or the flow aborts before touching anything, so the
   Run button in the Prefect UI can't wipe a database by accident. Pass
   `-p run_harvest=false` to leave it empty.

3. Scale workers (more concurrent runs) on the same host:
   ```sh
   docker compose up -d --scale prefect_worker=N
   ```
   Registration is idempotent, so extra replicas are safe.

4. Run a worker on **another host** (added capacity): the central Prefect API
   and DB must be network-reachable, and the `cde-harvester` image must be
   available there (registry pull, or `docker save | ssh | docker load`). Then:
   ```sh
   PREFECT_API_URL=https://<prefect-host>/api DB_HOST_EXTERNAL=<db-host> \
     docker compose -f docker-compose.worker.yaml up -d
   ```
   Remote workers set `REGISTER_DEPLOYMENTS=false` so they only poll. Note that
   CSV/log output and caches are local to each host (plain named volumes aren't
   shared across hosts); the DB is the source of truth.

