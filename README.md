# CEDA - CIOOS Exploration and Data Discovery

## Development

- To run CEDA locally, you will need Docker, Python and Node and a few terminal windows

- Rename .env.sample from the root directory to .env and change any settings if needed. If you are running on your local machine these settings don't need to change

- Start a local database using `docker`:
  `docker-compose up db -d`
- Setup Python virtual env and install Python modules:

  ```sh
  python3 -m venv venv
  source venv/bin/activate
  pip install -e ./downloader ./scheduler ./scraper
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

- Scrape one dataset

  ```sh
    python -m erddap_scraper https://data.cioospacific.ca/erddap --dataset_ids BCSOP_daily
  ```

- See website at <http://localhost:8000>

## Handy docker commands

See which CEDA services are running:
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
docker rm ceda_postgres-data
docker-compose up -d db
```

Delete tile cache:
`docker rm ceda_redis-data`

Redis CLI:
`docker exec -it ceda_redis_1 redis-cli`

Flush redis cache:
`docker exec -it ceda_redis_1 redis-cli FLUSHALL`

## Starting using docker

1. Install [Docker](https://docs.docker.com/get-docker/) and [Docker compose](https://docs.docker.com/compose/install/). New versions of Docker include `docker-compose`
1. Rename .env.sample to .env and change any settings if needed. If you are running on your local machine these settings don't need to change
1. `docker-compose up -d` to start all services. This will take a few minute to download, build, create the database schema.
1. Start your python3 environment, eg `python3 -m venv venv && source venv/bin/activate`
1. Run scraper to load data. From this directory, run:
   `sh data_loader.sh` to load all data or `sh data_loader_test.sh` to just load one dataset for testing purposes
1. See website at <http://localhost:5050>

## Production deployment

From the production server,

- rename `.env.sample` to `production.env` and configure.

- ```sh
  git pull
  sudo docker-compose -f docker-compose.production.yaml up -d --build
  ```

- To scrape data:

  ```sh
  source virtualenv/bin/activate
  pip install -e ./scraper
  sh data_loader.sh
  ```

- Add a crontab entry for the scheduler to run nightly.
