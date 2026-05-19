FROM ghcr.io/astral-sh/uv:python3.10-bookworm

WORKDIR /app

# 1. Copy path dependency (db-loader) and manifests for harvester
COPY ./db-loader /app/db-loader
COPY ./harvester/pyproject.toml ./harvester/uv.lock ./harvester/README.md ./harvester/

WORKDIR /app/harvester

# 2. Install dependencies only (no project code yet)
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-install-project || (echo "Lock mismatch, regenerating" && uv lock && uv sync --no-install-project)

# 3. Copy source code
COPY ./harvester/cde_harvester ./cde_harvester
COPY ./harvester/run.sh ./run.sh

# Bake in default harvest config and OBIS dataset list so the image is self-contained
# (no host bind-mounts required). Operators can override at runtime if needed.
COPY ./harvest_config.sample.yaml ./harvest_config.yaml
COPY ./Obis_Datasets.json ./Obis_Datasets.json

# 4. Install project itself
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked || (echo "Lock mismatch final stage, aborting" && exit 1)

#CMD ["sh","run.sh"]
CMD ["uv", "run", "python", "-m", "cde_harvester.prefect_pipeline", "-f", "harvest_config.yaml"]
