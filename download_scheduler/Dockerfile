FROM ghcr.io/astral-sh/uv:python3.14-trixie-slim

# git: uv fetches the git-sourced dependencies (metadata-xml,
# cioos-metadata-conversion), and the slim base doesn't ship it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home app

# No gcc/libc-dev/libgeos-dev/python3-dev on purpose: every dependency installs
# from a binary wheel, and those packages drag in ~18 minutes of libc6/python3
# upgrades on a loaded build host.

WORKDIR /usr/src/app

COPY download_scheduler ./download_scheduler
COPY downloader ./downloader
COPY harvester ./harvester

WORKDIR /usr/src/app/download_scheduler
# --locked: without it uv may re-resolve to versions CI never tested.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-install-project

# Same split as harvester/Dockerfile: root-owned code, `app` writes only the
# workdir (each job's cde_download_* temp folder) and the downloads volume.
# Without it, every `uv run` rebuilds the editable install into the read-only
# venv and fails; the build already synced it --locked.
ENV UV_NO_SYNC=1
ENV WRITABLE_DIRS="downloads"
RUN mkdir $WRITABLE_DIRS && chown app:app . $WRITABLE_DIRS

COPY --chmod=755 scripts/drop-privileges.sh /usr/local/bin/drop-privileges
ENTRYPOINT ["drop-privileges"]

# poll_once() touches downloads/healthz after every served poll. Missing or
# stale means the loop is dead, hung, or cannot reach the database. The hour of
# slack is for a single long download, which blocks the loop while it runs.
HEALTHCHECK --interval=60s --timeout=5s --start-period=60s --retries=3 \
  CMD find downloads/healthz -mmin -60 | grep -q .

CMD [ "uv", "run", "python", "-m", "download_scheduler" ]
