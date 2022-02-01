#!/usr/bin/env python

from distutils.core import setup

setup(
    name="erddap_scraper",
    version="0.1",
    description="",
    url="",
    packages=["erddap_scraper"],
    include_package_data=True,
    package_data={"": ["eovs_to_standard_name.json", "supported_eovs.csv"]},
    install_requires=[
        "pandas",
        "erddapy",
        "shapely",
        "sqlalchemy",
        "psycopg2-binary",
        "python-dotenv",
        "diskcache",
        "lxml",
    ],
)
