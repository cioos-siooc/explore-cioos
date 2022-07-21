#!/bin/sh
python -m cde_harvester -f harvest_config.yaml && python -m cde_db_loader
