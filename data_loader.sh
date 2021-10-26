#!/bin/sh

# stop on errors
set -e

python -m erddap_scraper https://data.cioospacific.ca/erddap/,https://catalogue.hakai.org/erddap,https://www.smartatlantic.ca/erddap,https://cioosatlantic.ca/erddap,https://erddap.ogsl.ca/erddap,http://dap.onc.uvic.ca/erddap
python -m ckan_scraper
