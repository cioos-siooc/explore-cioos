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
#   RUN_ON_DEPLOY         (default false) fire a harvest on deploy:
#                           false        never
#                           true/once    only when the database is empty (new install)
#                           always       every deploy, regardless of DB contents
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
if [ -n "${HARVEST_CONFIG_B64:-}" ]; then
  echo "[worker-entrypoint] Harvest config: HARVEST_CONFIG_B64 env var"
elif [ -f "${CONFIG_FILE}" ]; then
  echo "[worker-entrypoint] Harvest config: ${CONFIG_FILE}"
else
  echo "[worker-entrypoint] ERROR: no harvest config found at '${CONFIG_FILE}' and HARVEST_CONFIG_B64 is not set." >&2
  echo "[worker-entrypoint] Provide one via:" >&2
  echo "[worker-entrypoint]   1. HARVEST_CONFIG_B64 env var holding the whole YAML file" >&2
  echo "[worker-entrypoint]      base64-encoded on one line (Coolify UI). Generate it with:" >&2
  echo "[worker-entrypoint]        base64 < harvest_config.yaml | tr -d '\\n'" >&2
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

  # Decide whether to fire a harvest on this deploy. Only the registrar reaches
  # here, so it runs once per deploy regardless of replica count.
  RUN_ON_DEPLOY_MODE="${RUN_ON_DEPLOY:-false}"
  SHOULD_HARVEST=false
  case "${RUN_ON_DEPLOY_MODE}" in
    always)
      SHOULD_HARVEST=true
      echo "[worker-entrypoint] RUN_ON_DEPLOY=always -> triggering harvest fan-out"
      ;;
    true|once)
      # Run only on a fresh install: an empty (or not-yet-created) cde.datasets.
      if uv run python -m cde_harvester.core.db; then
        SHOULD_HARVEST=true
        echo "[worker-entrypoint] RUN_ON_DEPLOY=${RUN_ON_DEPLOY_MODE} and database is empty -> triggering initial harvest fan-out"
      else
        echo "[worker-entrypoint] RUN_ON_DEPLOY=${RUN_ON_DEPLOY_MODE} but database already holds datasets -> skipping harvest"
      fi
      ;;
    *)
      echo "[worker-entrypoint] RUN_ON_DEPLOY=${RUN_ON_DEPLOY_MODE} -> not triggering a deploy harvest"
      ;;
  esac

  if [ "${SHOULD_HARVEST}" = "true" ]; then
    # Triggers the orchestrator, which launches one harvest job per server (same
    # as the cron path). Non-fatal so a transient API hiccup can't block the
    # worker.
    uv run prefect deployment run "Harvest All Sources/cde-harvest-all" \
      || echo "[worker-entrypoint] run-on-deploy trigger failed; worker will still start"
  fi
fi

# Cap how many flow runs this worker executes at once. "Harvest All Sources"
# fans out one child run per configured source (10+), and under `--type process`
# each becomes a separate OS process. Unbounded, ten parallel harvests (the OBIS
# parquet path being the heaviest) exhausted RAM + all swap on a 15.7 GB host on
# 2026-08-04 and livelocked it. Raise deliberately, with headroom to match.
WORKER_LIMIT="${HARVEST_WORKER_LIMIT:-2}"

echo "[worker-entrypoint] Starting process worker on pool ${POOL_NAME} (concurrency limit ${WORKER_LIMIT})"
exec uv run prefect worker start --pool "${POOL_NAME}" --type process \
  --limit "${WORKER_LIMIT}"
