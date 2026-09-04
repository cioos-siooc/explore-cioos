#!/usr/bin/env sh

# Prefect 3.x: reset the database via the CLI inside the container
docker compose exec prefect /opt/conda/envs/prefect/bin/prefect server database reset -y

