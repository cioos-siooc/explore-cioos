#!/bin/sh
uv run python -m cde_harvester -f harvest_config.yaml && uv run python -m cde_db_loader
