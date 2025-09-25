FROM ghcr.io/astral-sh/uv:python3.10-bookworm

# for shapely, pdf creation
RUN apt-get -y -qq update
# libqt5gui5 needed by wkhtmltopdf
RUN apt-get -y -qq install gcc libc-dev libgeos-dev python3-dev wkhtmltopdf libqt5gui5

# See https://github.com/wkhtmltopdf/wkhtmltopdf/issues/4497. exit 0 so it doesnt fail on ARM

# NOTE: THIS MUST STAY AS A SINGLE LINE
RUN strip --remove-section=.note.ABI-tag /usr/lib/x86_64-linux-gnu/libQt5Core.so.5;exit 0

WORKDIR /usr/src/app

COPY download_scheduler ./download_scheduler
COPY downloader ./downloader
COPY harvester ./harvester
COPY db-loader ./db-loader

WORKDIR /usr/src/app/download_scheduler
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --no-install-project

CMD [ "uv", "run", "python", "-m", "download_scheduler" ]
