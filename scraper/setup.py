#!/usr/bin/env python

from distutils.core import setup

setup(
    name="erddap_scraper",
    version="0.1",
    description="",
    url="",
    packages=["erddap_scraper"],
    install_requires=[
        "pandas",
        "erddapy",
        "shapely",
        "sqlalchemy",
        "psycopg2-binary",
        "python-dotenv"
    ],
)
