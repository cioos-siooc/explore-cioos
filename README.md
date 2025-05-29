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

- To run CDE locally, you will need Docker, Python and Node and a few terminal windows

- Rename .env.sample from the root directory to .env and change any settings if needed. If you are running on your local machine these settings don't need to change

- Start a local database using `docker`:
  `docker-compose up -d db`
- Setup Python virtual env and install Python modules:

  ```sh
  conda create -n cde python=3.10
  conda activate cde
  pip install -e ./downloader -e ./download_scheduler -e ./harvester -e ./db-loader
  ```

- Start the API:

  ```sh
      cd web-api
      npm install
      npm start
  ```

- Start the download scheduler:

  ```sh
      python -m download_scheduler
  ```

- Start the frontend:

  ```sh
      cd frontend
      npm install
      npm start
  ```

- Harvest a single dataset and load CKAN data.

  ```sh
    sh data_loader_test.sh
  ```

- See website at <http://localhost:8000>

## Handy docker commands

See which cde services are running:
`docker-compose ps`

Start all containers, the first time this runs it will build containers:
`docker-compose up -d`

Tail logs:
`docker-compose logs -f`

(Re/)Build and (re/)start all containers that have code changes:
`docker-compose -f docker-compose.production.yaml up -d --build`

Rebuild database: (this will erase all your data)

```sh
docker-compose stop db
docker volume rm cde_postgres-data
docker-compose up -d db
```

Redis CLI:
`docker exec -it cde_redis_1 redis-cli`

Flush redis tile cache:
`docker exec -it cde_redis_1 redis-cli FLUSHALL`

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
