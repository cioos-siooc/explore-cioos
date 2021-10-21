#!/bin/sh

# This runs quicker by scraping only one dataset

# stop on errors
set -e

# From root of this repo
pip install -e ./scraper

# load .env file and allow comments
export $(cat .env | sed 's/#.*//g' | xargs)

# load ckan,dataset,profile into temporary tables
cd scraper

python -m ckan_scraper
python -m erddap_scraper https://data.cioospacific.ca/erddap --dataset_ids BCSOP_daily

cd ..

# process from temporary tables into into real tables
export PGPASSWORD="$DB_PASSWORD" PGUSER="$DB_USER" PGDATABASE="$DB_NAME" PGHOST="$DB_HOST_EXTERNAL"
psql <./database/profile_process.sql
psql <./database/create_hexes.sql
psql <./database/ckan_process.sql
