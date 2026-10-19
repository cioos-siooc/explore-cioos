#!/bin/sh
# Entrypoint for the prefect_worker service.
#
# Registers deployments, then starts a PROCESS worker. Env-driven so the same
# image works for the primary worker, scaled replicas, and remote workers:
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
# Fail fast instead of an obscure traceback at registration. Priority mirrors
# cde_harvester/core/config.py:resolve_harvest_config_file.
CONFIG_FILE="${HARVEST_CONFIG_FILE:-harvest_config.yaml}"
if [ -n "${HARVEST_CONFIG_YAML:-}" ] && [ -z "${HARVEST_CONFIG_B64:-}" ]; then
  echo "[worker-entrypoint] ERROR: HARVEST_CONFIG_YAML is no longer supported." >&2
  echo "[worker-entrypoint] Move the config to HARVEST_CONFIG_B64 and unset HARVEST_CONFIG_YAML:" >&2
  echo "[worker-entrypoint]   base64 < harvest_config.yaml | tr -d '\\n'" >&2
  exit 1
elif [ -n "${HARVEST_CONFIG_B64:-}" ]; then
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

# --- Database pre-flight -----------------------------------------------------
# Coolify supplies none of DB_NAME/DB_USER/DB_PASSWORD; without them the worker
# registers fine and then every flow run dies at connection time.
MISSING_DB="$(uv run python -m cde_harvester.core.db --print-missing 2>/dev/null || true)"
if [ -n "${MISSING_DB}" ]; then
  echo "[worker-entrypoint] ERROR: missing database settings: ${MISSING_DB}" >&2
  echo "[worker-entrypoint] Every harvest and the Rebuild Database flow need these to" >&2
  echo "[worker-entrypoint] connect. Set them on the deployment (Coolify: the app's" >&2
  echo "[worker-entrypoint] Environment Variables tab) or in a .env, then redeploy:" >&2
  echo "[worker-entrypoint]   DB_NAME=cde" >&2
  echo "[worker-entrypoint]   DB_USER=postgres" >&2
  echo "[worker-entrypoint]   DB_PASSWORD=<the db superuser password>" >&2
  echo "[worker-entrypoint] DB_HOST_EXTERNAL defaults to 'db' in compose; DB_PORT to 5432." >&2
  echo "[worker-entrypoint] See .env.coolify.sample for the full list." >&2
  exit 1
fi
echo "[worker-entrypoint] Database settings present for ${DB_NAME}"

if [ "${REGISTER_DEPLOYMENTS:-true}" = "true" ]; then
  echo "[worker-entrypoint] Registering process work pool + deployments..."
  # Best-effort: with N replicas, a loser of the "already exists" race must not
  # crash the container before the worker starts.
  uv run python -m cde_harvester.prefect_pipeline -f "${CONFIG_FILE}" -d prod \
    || echo "[worker-entrypoint] registration failed (another replica may have won); continuing"

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
    # Non-fatal so a transient API hiccup can't block the worker.
    uv run prefect deployment run "Harvest All Sources/cde-harvest-all" \
      || echo "[worker-entrypoint] run-on-deploy trigger failed; worker will still start"
  fi
fi

# Cap concurrent flow runs: unbounded, ten parallel harvests (one OS process
# each) exhausted RAM + swap on a 15.7 GB host and livelocked it.
# --with-healthcheck serves /health on :8080 for the compose healthcheck.
WORKER_LIMIT="${HARVEST_WORKER_LIMIT:-2}"

echo "[worker-entrypoint] Starting process worker on pool ${POOL_NAME} (concurrency limit ${WORKER_LIMIT})"
exec uv run prefect worker start --pool "${POOL_NAME}" --type process \
  --limit "${WORKER_LIMIT}" --with-healthcheck
