# Scrapers

- Run the scrapers from this directory only
- Copy .env.sample to .env and change if needed.
- Install with `pip install -e .`

## ERDDAP scraper

- `python -m erddap_scraper https://catalogue.hakai.org/erddap,https://www.smartatlantic.ca/erddap`
- `python -m erddap_scraper https://catalogue.hakai.org/erddap --dataset_ids HakaiQuadraBoLResearch`

## CKAN scraper

- `python -m ckan_scraper`
