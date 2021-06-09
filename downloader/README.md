# ERDDAP and CKAN downloader

## Installation
1. Go the the downloader directory of the ceda package and Run the following command in a command shell: 
    ```python
    pip install -e .
    ```

2. Go to the scraper diretory and install the scraper package and Run the same command:
    ```python
    pip install -e .
    ```

3. Download and install [wkhtmltopdf](https://wkhtmltopdf.org/downloads.html)

## Description
The CEDA downloader uses an CEDA json query (ex: downloader/test/*.json ) to retrieve matching data 
form multiple CIOOS datasets. Downloader will for each datasets :
1. Retrieve a pdf copy of the CKAN page dataset
2. Retrieve copy of the data through ERDDAP in the specified format. 
3. Data filtered spatially to match the only data present within the provided polygon if:
    1. Format: CSV
    2. Region selected via polygon
    
