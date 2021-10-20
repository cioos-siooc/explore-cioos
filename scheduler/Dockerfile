FROM python:3.9-slim-buster

# for shapely, pdf creation
RUN apt-get -y update
RUN apt-get -y install gcc libc-dev libgeos-dev python3-dev

WORKDIR /usr/src/app

COPY . .

RUN pip install ./downloader
RUN pip install ./scheduler
RUN pip install ./scraper

# -u seems to be needed to get it to print to stdout
CMD [ "python", "-u","-m","download_scheduler" ]
