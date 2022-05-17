#!/usr/bin/env python

from distutils.core import setup

setup(
    name="erddap_scraper",
    version="0.1",
    description="",
    url="",
    packages=["erddap_scraper"],
    include_package_data=True,
    package_data={"": ["ocean_variables_to_goos.json", "goos_to_standard_name.json"]},
    install_requires=[
        "pandas",
        "erddapy",
        "shapely",
        "sqlalchemy",
        "psycopg2-binary",
        "python-dotenv",
        "diskcache",
        "lxml",
        "numpy",
    ],
)
