FROM ghcr.io/astral-sh/uv:python3.10-bookworm

WORKDIR /app

COPY uv.lock pyproject.toml ./
# Install dependencies
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-install-project 

# Copy application files
COPY cde_harvester .
# COPY downloader /app/downloader
COPY cde_db_loader .
# COPY download_scheduler /app/download_scheduler
COPY run.sh .

# Sync the project
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked

CMD [ "sh","run.sh" ]
