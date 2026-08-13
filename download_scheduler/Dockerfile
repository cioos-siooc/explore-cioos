FROM ghcr.io/astral-sh/uv:python3.10-bookworm

RUN apt-get -y -qq update

# No gcc/libc-dev/libgeos-dev/python3-dev here on purpose. Nothing compiles:
# uv installs every dependency from a binary wheel (shapely bundles its own
# GEOS, psycopg2-binary its own libpq). Installing them cost far more than the
# 11 packages suggested, because libc-dev and python3-dev drag in upgrades of
# libc6 and python3.11 in the base image — ~18 minutes of unpacking on a loaded
# build host, long enough that the layer never finished or cached.

# for pdf creation (CREATE_PDF=True). libqt5gui5 is needed by wkhtmltopdf, and
# fonts-dejavu-core is named explicitly because it would otherwise only arrive
# as a recommend — without it wkhtmltopdf renders PDFs with missing glyphs.
RUN apt-get -y -qq install --no-install-recommends \
    wkhtmltopdf libqt5gui5 fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# See https://github.com/wkhtmltopdf/wkhtmltopdf/issues/4497. exit 0 so it doesnt fail on ARM

# NOTE: THIS MUST STAY AS A SINGLE LINE
RUN strip --remove-section=.note.ABI-tag /usr/lib/x86_64-linux-gnu/libQt5Core.so.5;exit 0

WORKDIR /usr/src/app

COPY download_scheduler ./download_scheduler
COPY downloader ./downloader
COPY harvester ./harvester

WORKDIR /usr/src/app/download_scheduler
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --no-install-project

CMD [ "uv", "run", "python", "-m", "download_scheduler" ]
