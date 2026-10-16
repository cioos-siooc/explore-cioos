#!/usr/bin/env sh

docker compose exec prefect /opt/conda/envs/prefect/bin/prefect server database reset -y
