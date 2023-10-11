# ERDDAP harvester

## Installation with venv

```bash
cd harvester
python -m venv venv
source ./venv/bin/activate
pip install .
```

## Running

The erddap harvester also calls the CKAN harvester

- `python -m cde_harvester --urls https://catalogue.hakai.org/erddap,https://www.smartatlantic.ca/erddap`

- Request one or more dataset IDs (comma separated)
  `python -m cde_harvester --urls https://catalogue.hakai.org/erddap --dataset_ids HakaiQuadraBoLResearch`
- Use request caching, when this is run twice the second one should use cached responses
  `python -m cde_harvester --urls https://catalogue.hakai.org/erddap --cache`

## Standalone CKAN harvester

Only used for testing as it is called by the erddap harvester

- `python -m cde_harvester.ckan`
