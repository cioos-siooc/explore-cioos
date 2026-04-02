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
3. Copy `harvest_config.sample.yaml` to `harvest_config.yaml` and modify if needed.
4. Run locally with docker compose:
    1. Development environment: `docker compose up -d`
    2. Production environment: `docker compose -f docker-compose.production.yaml up -d`
5. See website at <http://localhost:8098>
6. See Prefect Dashboard at <http://localhost:4200> (Manage flows and deployments)

### Data Harvesting with Prefect

The harvester is now orchestrated by Prefect. The Docker Compose stack includes:
- **Prefect Server**: Manage flows, view logs, and trigger runs.
- **Prefect Worker**: Executes scheduled flows in Docker containers.

To deploy the harvester flow (create/update schedule):
```bash
docker compose up harvester
```
*Note: Set `INCREMENTAL_MODE=true` in your `.env` to make the deployment default to incremental harvesting (faster, only updates changed datasets).*

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

## Production deployment

Deploy CDE to production using Docker Compose with the production configuration file.

### Initial Setup

1. Rename `.env.sample` to `production.env` and configure with production settings.

2. Copy `harvest_config.sample.yaml` to `harvest_config.yaml` and configure the datasets to harvest.

3. Delete old redis and postgres data (if needed):

   ```sh
   sudo docker volume rm cde_postgres-data cde_redis-data
   ```

4. Start all services using the production Docker Compose file:

   ```sh
   sudo docker compose -f docker-compose.production.yaml up -d --build
   ```

### Data Harvesting (Production)

The harvester should be run on a schedule to keep the data up to date. Since we use Prefect for orchestration, you don't need a system cron job.

1. Ensure the Prefect Server and Worker are running:
   ```sh
   docker compose -f docker-compose.production.yaml up -d prefect worker
   ```

2. Deploy the harvester flow with a schedule (defined in `.env` via `HARVESTER_CRON`):
   ```sh
   docker compose -f docker-compose.production.yaml up harvester
   ```
   *Note: By default, this runs in **Incremental Mode** if `INCREMENTAL_MODE=true` is set in your `.env`. This creates a deployment that only harvests changed datasets.*

This registers the deployment with Prefect. The worker will automatically pick up and execute jobs according to the schedule.

