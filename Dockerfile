# Run `docker build .` from this folder to test
FROM centos:7

# for shapely, pdf creation
RUN yum install -y gcc libc-dev geos-dev geos-devel wkhtmltopdf zip unzip python3-pip which python3-devel

COPY . /downloader
WORKDIR /downloader

RUN pip3 install -q ./scraper
RUN pip3 install -q ./downloader

RUN sh -c "python3 -m erddap_downloader downloader/test/test_query.json && \
    unzip out/*zip && \
    ls"

# Verify that a real CSV was created
RUN python3 -c "import pandas,glob; \
               csv_file=glob.glob('ceda_download*/*.csv')[0]; \
               print('Loading csv_file:',csv_file); \
               df=pandas.read_csv(csv_file); \
               print(df)"
