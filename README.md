# CDE - CIOOS Exploration and Data Discovery

[![Test](https://github.com/HakaiInstitute/cde/actions/workflows/build_and_test.yaml/badge.svg)](https://github.com/HakaiInstitute/cde/actions/workflows/build_and_test.yaml)

## Testing a dataset

If you just want to see how a dataset is harvested by CDE:

1. Start your python environment environment, `conda create -n cde python=3.10;conda activate cde`
2. `pip install -e .`
3. `python -m cde_harvester --urls https://data.cioospacific.ca/erddap --dataset_ids ECCC_MSC_BUOYS`
4. See files in `harvest` folder

## Starting using docker

1. Install [Docker](https://docs.docker.com/get-docker/) and [Docker compose](https://docs.docker.com/compose/install/). New versions of Docker include `docker compose`
2. Rename file `.env.sample` to `.env` and change any settings if needed. If you are running on your local machine these settings don't need to change
3. Copy `harvest_config.sample.yaml` to `harvest_config.yaml` and modify if needed.
4. Run locally with docker compose:
    1. Development environment: `docker compose up -d`
    2. Production environment: `docker compose -f docker-compose.production.yaml up -d`
5. See website at <http://localhost:8098>
6. To update database and reharvest datasets:
    1. Development environment:  `docker compose up -d harvester`
    2. Production environment: `docker compose -f  docker-compose.production.yaml up -d harvester`

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

2. Start a local database using `docker`:

   ```sh
   docker compose up -d db
   ```

3. Setup Python virtual env and install Python modules:

   ```sh
   conda create -n cde python=3.10
   conda activate cde
   pip install -e ./downloader -e ./download_scheduler -e ./harvester -e ./db-loader
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

From the production server,

- rename `.env.sample` to `production.env` and configure.

- Delete old redis and postgres data (if needed):
  `sudo docker volume rm cde_postgres-data cde_redis-data`

- Start all services:
  `sudo docker-compose -f docker-compose.production.yaml up -d --build`

- Harvest data:

  ```sh
  conda create -n cde python=3.10
  conda activate cde
  pip install -e ./harvester -e ./db-loader
  sh data_loader.sh
  ```

- Add a crontab entry for the scheduler to run nightly.

- deploy frontend to Gitpages

  ```sh
  API_URL=https://explore.cioos.ca/api npm run deploy
  ```
