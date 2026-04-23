FROM ghcr.io/astral-sh/uv:python3.10-bookworm

RUN apt-get -y -qq update && apt-get -y -qq install curl

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

# 4. Install project itself
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked || (echo "Lock mismatch final stage, aborting" && exit 1)

HEALTHCHECK --interval=60s --timeout=10s --retries=2 \
  CMD test -f /tmp/harvester.pid && ps -p $(cat /tmp/harvester.pid) > /dev/null || exit 1

CMD ["sh","run.sh"]
