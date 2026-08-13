FROM ghcr.io/astral-sh/uv:python3.10-bookworm

RUN apt-get -y -qq update

# Split into two layers on purpose. Bundled as one RUN this pulled 210 packages
# and took >18 minutes on a loaded build host — long enough to be killed before
# it finished, so it cached nothing and every retry paid the full cost again.
# Build deps are the cheap half (11 packages): as their own layer they cache
# immediately, leaving only the wkhtmltopdf half to retry.
# --no-install-recommends takes the total from 210 packages to 94.

# for shapely
RUN apt-get -y -qq install --no-install-recommends \
    gcc libc-dev libgeos-dev python3-dev

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
