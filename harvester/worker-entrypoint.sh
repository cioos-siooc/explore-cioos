#!/bin/sh
# Entrypoint for the prefect_worker service.
#
# Folds the old one-shot `prefect_deployment` bootstrap into the worker's own
# startup, then starts a long-running PROCESS worker that runs harvest flows
# in-process (no spawned flow-run containers, no docker socket).
#
# All behaviour is env-driven so the same image works for the primary worker,
# scaled replicas, and remote workers:
#
#   REGISTER_DEPLOYMENTS  (default true)  register work pool + deployments first
#   RUN_ON_DEPLOY         (default false) fire one full harvest immediately
#   HARVESTER_CRON / VERNACULARS_CRON     (optional) recurring schedules
#
# Remote workers set REGISTER_DEPLOYMENTS=false so they ONLY poll the central
# Prefect server and never re-register or re-trigger.
set -e

POOL_NAME="cde-process-pool"

if [ "${REGISTER_DEPLOYMENTS:-true}" = "true" ]; then
  echo "[worker-entrypoint] Registering process work pool + deployments..."
  # Best-effort: with N replicas, only one needs to win. A loser hitting an
  # "already exists" race must not crash the container before the worker starts.
  uv run python -m cde_harvester.prefect_pipeline -f harvest_config.yaml -d prod \
    || echo "[worker-entrypoint] registration failed (another replica may have won); continuing"

  if [ "${RUN_ON_DEPLOY:-false}" = "true" ]; then
    echo "[worker-entrypoint] RUN_ON_DEPLOY=true -> triggering per-server harvest fan-out"
    # Only the registrar fires this, so it runs once per deploy regardless of
    # replica count. Triggers the orchestrator, which launches one harvest job
    # per server (same as the cron path). Non-fatal so a transient API hiccup
    # can't block the worker.
    uv run prefect deployment run "Harvest All Sources/cde-harvest-all" \
      || echo "[worker-entrypoint] run-on-deploy trigger failed; worker will still start"
  fi
fi

echo "[worker-entrypoint] Starting process worker on pool ${POOL_NAME}"
exec uv run prefect worker start --pool "${POOL_NAME}" --type process
