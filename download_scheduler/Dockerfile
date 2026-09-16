FROM ghcr.io/astral-sh/uv:python3.10-bookworm

RUN apt-get -y -qq update

# No gcc/libc-dev/libgeos-dev/python3-dev here on purpose. Nothing compiles:
# uv installs every dependency from a binary wheel (shapely bundles its own
# GEOS, psycopg2-binary its own libpq). Installing them cost far more than the
# 11 packages suggested, because libc-dev and python3-dev drag in upgrades of
# libc6 and python3.11 in the base image — ~18 minutes of unpacking on a loaded
# build host, long enough that the layer never finished or cached.

# PDF generation (CREATE_PDF=True) needs wkhtmltopdf, which is opt-in at build
# time because it is enormous: even with --no-install-recommends it pulls the
# whole Qt/Mesa stack (libllvm15, libdrm-*, libgstreamer, wayland, xcb — ~83
# packages) for a feature that is off by default on every deployment. Enable it
# with:  docker compose build --build-arg INSTALL_PDF=true scheduler
# libqt5gui5 is needed by wkhtmltopdf, and fonts-dejavu-core is named
# explicitly because it would otherwise only arrive as a recommend — without it
# wkhtmltopdf renders PDFs with missing glyphs.
ARG INSTALL_PDF=false
RUN if [ "$INSTALL_PDF" = "true" ]; then \
        apt-get -y -qq install --no-install-recommends \
            wkhtmltopdf libqt5gui5 fonts-dejavu-core; \
    fi \
    && rm -rf /var/lib/apt/lists/*

# See https://github.com/wkhtmltopdf/wkhtmltopdf/issues/4497. exit 0 so it doesnt fail on ARM

# NOTE: THIS MUST STAY AS A SINGLE LINE
RUN strip --remove-section=.note.ABI-tag /usr/lib/x86_64-linux-gnu/libQt5Core.so.5;exit 0

WORKDIR /usr/src/app

# harvester is deliberately NOT copied: the scheduler used to depend on it to
# reach the issue grouping and the reason codes, which meant this image also
# installed Prefect, duckdb, redis, pandera and erddapy. Those pieces are in
# python-common/ now (see python-common/README.md).
COPY download_scheduler ./download_scheduler
COPY downloader ./downloader
COPY python-common ./python-common

WORKDIR /usr/src/app/download_scheduler
# --locked, like harvester/Dockerfile: without it uv is free to re-resolve
# and the image can pin different transitive versions than CI tested.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-install-project

CMD [ "uv", "run", "python", "-m", "download_scheduler" ]
