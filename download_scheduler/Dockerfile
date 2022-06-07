FROM python:3.9-slim-buster

# for shapely, pdf creation
RUN apt-get -y -qq update
# libqt5gui5 needed by wkhtmltopdf
RUN apt-get -y -qq install gcc libc-dev libgeos-dev python3-dev wkhtmltopdf libqt5gui5

# See https://github.com/wkhtmltopdf/wkhtmltopdf/issues/4497. exit 0 so it doesnt fail on ARM

# NOTE: THIS MUST STAY AS A SINGLE LINE
RUN strip --remove-section=.note.ABI-tag /usr/lib/x86_64-linux-gnu/libQt5Core.so.5;exit 0

WORKDIR /usr/src/app

COPY . .

RUN pip install -q ./downloader
RUN pip install -q ./download_scheduler
RUN pip install -q ./scraper

# -u seems to be needed to get it to print to stdout
CMD [ "python", "-u","-m","download_scheduler" ]
