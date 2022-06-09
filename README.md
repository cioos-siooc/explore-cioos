# CDE - CIOOS Exploration and Data Discovery

## Starting using docker

1. Install [Docker](https://docs.docker.com/get-docker/) and [Docker compose](https://docs.docker.com/compose/install/). New versions of Docker include `docker-compose`
1. Rename .env.sample to .env and change any settings if needed. If you are running on your local machine these settings don't need to change
1. `docker-compose up -d` to start all services. This will take a few minute to download, build, create the database schema.
1. Start your python 3.9 or greater environment, eg `python3 -m venv venv && source venv/bin/activate`
1. `pip install -e ./scraper`
1. Run scraper to load data. From this directory, run: `sh data_loader_test.sh` to just load one dataset for testing purposes
1. See website at <http://localhost:8098>

## Development

- To run CDE locally, you will need Docker, Python and Node and a few terminal windows

- Rename .env.sample from the root directory to .env and change any settings if needed. If you are running on your local machine these settings don't need to change

- Start a local database using `docker`:
  `docker-compose up db -d`
- Setup Python virtual env and install Python modules:

  ```sh
  python3 -m venv venv
  source venv/bin/activate
  pip install -e ./downloader ./download_scheduler ./scraper
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

- Scrape a single dataset and load CKAN data.

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

- Scrape data:

  ```sh
  source venv/bin/activate
  pip install -e ./scraper
  sh data_loader.sh
  ```

- Add a crontab entry for the scheduler to run nightly.

- deploy frontend to Gitpages

  ```sh
  API_URL=https://explore.cioos.ca/api npm run deploy
  ```
