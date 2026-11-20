#!/usr/bin/env bash
# Run a full harvest on the stack's worker and wait for it; fails if the flow
# fails. Self-contained: on-host.sh ships only this file to a deploy host.
set -euo pipefail

deployment="Harvest Source/cde-harvester-deployment"
# CI passes its -f flags in COMPOSE_FILES; hosts rely on COMPOSE_FILE in .env.
# shellcheck disable=SC2086
worker() { docker compose ${COMPOSE_FILES:-} exec -T prefect_worker "$@"; }

# Compose can report the worker as started before its entrypoint has
# registered the deployments with Prefect. Wait for that registration.
for _ in $(seq 1 60); do
  if worker uv run prefect deployment inspect "$deployment" >/dev/null 2>&1; then
    # --watch returns a non-zero status if the harvest flow fails.
    worker uv run prefect deployment run "$deployment" --watch
    exit
  fi
  sleep 5
done
echo "$deployment was never registered" >&2
exit 1
