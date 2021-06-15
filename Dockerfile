# Run `docker build .` from this folder to test
FROM nickgryg/alpine-pandas

# for shapely, pdf creation
RUN sh -c "apk -q add --no-cache gcc libc-dev geos-dev wkhtmltopdf zip"

COPY . /

RUN sh -c "pip install -qe downloader  && \
    pip install -qe scraper && \
    mkdir out && cd out && \
    python -m erddap_downloader /downloader/test/test_query.json && \
    unzip *zip && \
    ls -l **/*"

# TODO get this line working and add after the unzip line
RUN python -c "import pandas,glob;csv_file=glob.glob('out/**/*.csv')[0];print('Loading csv_file:',csv_file);df=pandas.read_csv(csv_file);print(df)"
