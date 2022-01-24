# Scrapers

- Run the scrapers from this directory only
- Copy .env.sample to .env and change if needed.
- Install with `pip install -e .`

## ERDDAP scraper

The erddap scraper also calls the CKAN scraper

- `python -m erddap_scraper https://catalogue.hakai.org/erddap,https://www.smartatlantic.ca/erddap`

- Request one or more dataset IDs (comma separated)
  `python -m erddap_scraper https://catalogue.hakai.org/erddap --dataset_ids HakaiQuadraBoLResearch`

- Create CSVs only, dont write to DB:
  `python -m erddap_scraper https://catalogue.hakai.org/erddap --csv-only`

- Use request caching, when this is run twice the second one should use cached responses
  `python -m erddap_scraper https://catalogue.hakai.org/erddap --cache`

## CKAN scraper

Only used for testing as it is called by the erddap scraper

- `python -m erddap_scraper.ckan`

## ERDDAP estimate

- `python erddap_estimate path/to/ceda_query.json`
- `python erddap_estimate {ceda_query_json_string}`
