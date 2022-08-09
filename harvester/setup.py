#!/usr/bin/env python

from distutils.core import setup

setup(
    name="cde_harvester",
    version="0.1",
    description="",
    url="",
    packages=["cde_harvester", "cde_harvester.ckan"],
    include_package_data=True,
    package_data={"": ["cde_to_goos_eov.json", "goos_eov_to_standard_name.json"]},
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
        "pyyaml",
    ],
)