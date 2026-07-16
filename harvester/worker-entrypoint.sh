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

# --- Config pre-flight -------------------------------------------------------
# The image does not bake a harvest config; it must arrive at runtime. Fail
# fast with instructions instead of letting registration (or, on a remote
# worker, the first flow run) crash with an obscure traceback. Priority here
# mirrors cde_harvester/core/config.py:resolve_harvest_config_file.
CONFIG_FILE="${HARVEST_CONFIG_FILE:-harvest_config.yaml}"
if [ -n "${HARVEST_CONFIG_YAML:-}" ]; then
  echo "[worker-entrypoint] Harvest config: HARVEST_CONFIG_YAML env var"
elif [ -f "${CONFIG_FILE}" ]; then
  echo "[worker-entrypoint] Harvest config: ${CONFIG_FILE}"
else
  echo "[worker-entrypoint] ERROR: no harvest config found at '${CONFIG_FILE}' and HARVEST_CONFIG_YAML is not set." >&2
  echo "[worker-entrypoint] Provide one via:" >&2
  echo "[worker-entrypoint]   1. HARVEST_CONFIG_YAML env var containing the full YAML (Coolify UI), or" >&2
  echo "[worker-entrypoint]   2. a file mounted at /app/harvester/harvest_config.yaml" >&2
  echo "[worker-entrypoint]      (compose volume, or a Coolify Persistent Storage file mount), or" >&2
  echo "[worker-entrypoint]   3. HARVEST_CONFIG_FILE env var pointing at a mounted file." >&2
  exit 1
fi

if [ "${REGISTER_DEPLOYMENTS:-true}" = "true" ]; then
  echo "[worker-entrypoint] Registering process work pool + deployments..."
  # Re-runs on EVERY container start, so config changes are picked up by a
  # plain restart (file mount edits) or recreate (env var edits): .deploy()
  # updates existing deployments in place and adds per-source deployments for
  # newly configured servers.
  # Best-effort: with N replicas, only one needs to win. A loser hitting an
  # "already exists" race must not crash the container before the worker starts.
  uv run python -m cde_harvester.prefect_pipeline -f "${CONFIG_FILE}" -d prod \
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
