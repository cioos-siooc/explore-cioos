#!/bin/sh
#uv run python -m cde_harvester -f harvest_config.yaml && uv run python -m cde_harvester.loading
uv run python -m cde_harvester.prefect_pipeline -f harvest_config.yaml
