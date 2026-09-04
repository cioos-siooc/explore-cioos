FROM ghcr.io/astral-sh/uv:python3.10-bookworm

WORKDIR /app

# 1. Copy manifests for harvester
COPY ./harvester/pyproject.toml ./harvester/uv.lock ./harvester/README.md ./harvester/

WORKDIR /app/harvester

# 2. Install dependencies only (no project code yet)
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-install-project || (echo "Lock mismatch, regenerating" && uv lock && uv sync --no-install-project)

# 3. Copy source code (cde_db_loader is the deprecated `python -m cde_db_loader` shim)
COPY ./harvester/cde_harvester ./cde_harvester
COPY ./harvester/cde_db_loader ./cde_db_loader
COPY ./harvester/run.sh ./run.sh
COPY ./harvester/worker-entrypoint.sh ./worker-entrypoint.sh

# The harvest config is deliberately NOT baked into the image — it is provided
# at runtime so config changes never require a rebuild. Resolution order (see
# cde_harvester/core/config.py:resolve_harvest_config_file):
#   1. HARVEST_CONFIG_B64 env var (whole YAML file, base64 on one line; the
#      Coolify-safe channel — raw multi-line YAML gets mangled in transit)
#   2. HARVEST_CONFIG_YAML env var (raw YAML text; deprecated, corrupts easily)
#   3. HARVEST_CONFIG_FILE env var (path to a mounted file)
#   4. a file mounted at /app/harvester/harvest_config.yaml
# Startup fails with an actionable error when none is provided.
COPY ./Obis_Datasets.json ./Obis_Datasets.json

# The numbered schema files, so the "Rebuild Database" flow can recreate the schema
# after a deploy changes the table layout (Postgres applies 1_schema.sql only on a
# fresh volume, and db_migrate re-applies only the [3-9] function files). Read-only
# input to cde_harvester/core/schema.py; overridable via CDE_DATABASE_DIR.
COPY ./database /app/database

# 4. Install project itself
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked || (echo "Lock mismatch final stage, aborting" && exit 1)

#CMD ["sh","run.sh"]
CMD ["uv", "run", "python", "-m", "cde_harvester.prefect_pipeline", "-f", "harvest_config.yaml"]
