# CEDA - CIOOS Exploration and Data Discovery

1. Install or upgrade docker. New versions of Docker include `docker compose`
1. Rename sample.env to .env and change any settings if needed. If you are running on your local machine these settings don't need to change
1. `docker compose up -d` to start all services. This will take a few minute to download, build, create the database schema.
1. Start your python3 environment, eg `python3 -m venv venv && source venv/bin/activate`
1. Run scraper to load data, this will take up to an hour or so. From this directory, run:
   `sh data_loader.sh`
1. See website at <http://localhost:5050>

## Production deployment

From the production server, run:
`docker compose up -d`
Add a crontab entry for the scheduler to run nightly.

TODO: change where it writes the files to

## Development

- If you need to run a local database, run:
  `docker compose up db -d`

- Start the API by running `npm start` from the `web-api` directory
- Start the frontend by running `npm start` from the `frontend` directory

## Handy docker commands

Start all containers, the first time this runs it will build containers:
`docker compose up -d`

Tail logs:
`docker compose logs -f`

(Re/)Build and (re/)start one container:
``docker compose up frontend --build`

Delete database data:
`docker rm ceda_postgres-data`

Delete tile cache:
`docker rm ceda_redis-data`

Flush redis cache:
`docker exec -it ceda_redis_1 redis-cli FLUSHALL`
