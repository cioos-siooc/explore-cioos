#!/bin/sh

# stop on errors
set -e

python -m erddap_scraper https://data.cioospacific.ca/erddap --dataset_ids BCSOP_daily
python -m ckan_scraper
