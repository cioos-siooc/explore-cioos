# ERDDAP and CKAN downloader

## Installation

Substitute `pip3` for `pip` if required

1. Go the the downloader directory of the CDE package and Run the following command in a command shell:

   ```python
   pip install -e .
   ```

1. Go to the harvester directory and install the harvester package and Run the same command:

   ```python
   pip install -e .
   ```

1. Download and install [wkhtmltopdf](https://wkhtmltopdf.org/downloads.html)

## Description

The CDE downloader uses a json query (ex: downloader/test/\*.json ) to retrieve matching data
form multiple CIOOS datasets. Downloader will for each datasets :

1. Retrieve a pdf copy of the CKAN page dataset
2. Retrieve copy of the data through ERDDAP in the specified format.
3. Data filtered spatially to match the only data present within the provided polygon if:
   1. Format: CSV
   2. Region selected via polygon
