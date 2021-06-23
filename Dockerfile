# Run `docker build .` from this folder to test
FROM centos:7

# for shapely, pdf creation
RUN yum install -y gcc libc-dev geos-dev geos-devel wkhtmltopdf zip unzip python3-pip which python3-devel

COPY . /ceda
WORKDIR /ceda

RUN pip3 install ./scraper
RUN pip3 install -q ./downloader

WORKDIR /ceda/downloader
RUN sh test_downloader.sh
