# CEDA - CIOOS Exploration and Data Discovery

## Starting using docker

1. Install [Docker](https://docs.docker.com/get-docker/) and [Docker compose](https://docs.docker.com/compose/install/). New versions of Docker include `docker-compose`
1. Rename .env.sample to .env and change any settings if needed. If you are running on your local machine these settings don't need to change
1. `docker-compose up -d` to start all services. This will take a few minute to download, build, create the database schema.
1. Start your python3 environment, eg `python3 -m venv venv && source venv/bin/activate`
1. Run scraper to load data. From this directory, run:
   `sh data_loader.sh` to load all data or `sh data_loader_test.sh` to just load one dataset for testing purposes
1. See website at <http://localhost:5050>

## Production deployment

From the production server, run:
`docker-compose -f docker-compose.production.yaml up -d`
Add a crontab entry for the scheduler to run nightly.

## Development

- To run CEDA locally, you will need Python and Node and a few terminal windows

- Start a local database:
  `docker-compose up db -d`
- Setup Python virtual env and install Python modules:

  ```sh
  python3 -m venv venv && source venv/bin/activate
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
      cd scheduler
      python -m download_scheduler
  ```

- Start the frontend:

  ```sh
      cd frontend
      npm install
      npm start
  ```

- Scrape one dataset. NOTE: If you are running the scraper with `python -m erddap_scraper` you must first `cd` into the scraper directory.

  ```sh
    sh data_loader_test.sh
  ```

- See website at <http://localhost:8000>

## Handy docker commands

See which CEDA services are running:
`docker-compose ps`

Start all containers, the first time this runs it will build containers:
`docker-compose up -d`

Tail logs:
`docker-compose logs -f`

(Re/)Build and (re/)start one container:
``docker-compose up frontend --build`

Delete database data:
`docker rm ceda_postgres-data`

Delete tile cache:
`docker rm ceda_redis-data`

Flush redis cache:
`docker exec -it ceda_redis_1 redis-cli FLUSHALL`
