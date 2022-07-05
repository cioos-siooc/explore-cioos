# ERDDAP harvester

The erddap harvester also calls the CKAN harvester

- `python -m cde_harvester https://catalogue.hakai.org/erddap,https://www.smartatlantic.ca/erddap`

- Request one or more dataset IDs (comma separated)
  `python -m cde_harvester https://catalogue.hakai.org/erddap --dataset_ids HakaiQuadraBoLResearch`

- Create CSVs only, dont write to DB:
  `python -m cde_harvester https://catalogue.hakai.org/erddap`

- Use request caching, when this is run twice the second one should use cached responses
  `python -m cde_harvester https://catalogue.hakai.org/erddap --cache`

## Standalone CKAN harvester

Only used for testing as it is called by the erddap harvester

- `python -m cde_harvester.ckan`
