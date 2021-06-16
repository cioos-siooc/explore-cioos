# Run `docker build .` from this folder to test
FROM centos:7

# for shapely, pdf creation
RUN sh -c "yum install -q -y gcc libc-dev geos-dev wkhtmltopdf zip python3-pip which"

COPY . /

RUN sh -c "pip3 install -qe downloader  && \
    pip3 install -qe scraper && \
    mkdir out && cd out && \
    python3 -m erddap_downloader /downloader/test/test_query.json && \
    unzip *zip && \
    ls -l **/*"

# Verify that a real CSV was created
RUN python -c "import pandas,glob; \
               csv_file=glob.glob('out/**/*.csv')[0]; \
               print('Loading csv_file:',csv_file); \
               df=pandas.read_csv(csv_file); \
               print(df)"
