FROM ghcr.io/astral-sh/uv:python3.14-trixie-slim

# git: uv fetches the git-sourced dependencies (metadata-xml,
# cioos-metadata-conversion), and the slim base doesn't ship it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home app

WORKDIR /app

# 1. Copy manifests for harvester
COPY ./harvester/pyproject.toml ./harvester/uv.lock ./harvester/README.md ./harvester/

WORKDIR /app/harvester

# 2. Install dependencies only (no project code yet)
# --locked with no fallback: a lockfile mismatch must be fixed in the repo,
# not resolved to untested versions inside the build.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-install-project

# 3. Copy source code
COPY ./harvester/cde_harvester ./cde_harvester
COPY ./harvester/worker-entrypoint.sh ./worker-entrypoint.sh

# The harvest config is deliberately NOT baked in; it arrives at runtime (see
# cde_harvester/core/config.py:resolve_harvest_config_file).
COPY ./Obis_Datasets.json ./Obis_Datasets.json

# For the "Rebuild Database" flow (cde_harvester/core/schema.py).
COPY ./database /app/database

# 4. Install project itself
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked || (echo "Lock mismatch final stage, aborting" && exit 1)

# The source and venv stay root-owned, so `app` cannot modify them; it only
# writes new entries in the workdir and the volume mount points below. Mount
# points that exist in the image hand their owner to a new named volume.
# Without it, every `uv run` rebuilds the editable install into the read-only
# venv and fails; the build already synced it --locked.
ENV UV_NO_SYNC=1
ENV WRITABLE_DIRS="harvest logs harvester_cache obis_cache"
RUN mkdir $WRITABLE_DIRS && chown app:app . $WRITABLE_DIRS

COPY --chmod=755 ./scripts/drop-privileges.sh /usr/local/bin/drop-privileges
ENTRYPOINT ["drop-privileges"]

CMD ["uv", "run", "python", "-m", "cde_harvester.prefect_pipeline", "-f", "harvest_config.yaml"]
