#!/bin/sh
python -m -f harvest_config.yaml
python -m cde_db_loader --folder harvest
