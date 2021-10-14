# CEDA - CIOOS Exploration and Data Discovery

1. docker compose up to start all services
1. Setup the .env file in this directory to connect to a dev or production DB
1. Load data, this will 30 mins or so. From this directory, run:
   `sh database/data_loader_test.sh`
1. See website at <http://localhost:3000>

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

Build and start all containers:
`docker compose up -d --build`

Tail logs:
`docker compose logs -f`

(Re/)Build and (re/)start one container:
``docker compose up frontend --build`

Delete database data:
`docker rm ceda_postgres-data`

Delete tile cache:
`docker rm ceda_redis-data`
