#!/bin/sh
CONFIG_FILE="${HARVEST_CONFIG_FILE:-harvest_config.yaml}"
uv run python -m cde_harvester -f "$CONFIG_FILE" && uv run python -m cde_db_loader
