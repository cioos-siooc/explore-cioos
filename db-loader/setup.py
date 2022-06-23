#!/usr/bin/env python

from distutils.core import setup

setup(
    name="cde_db_loader",
    version="0.1",
    description="",
    url="",
    packages=["cde_db_loader"],
    install_requires=[
        "pandas",
        "sqlalchemy",
        "psycopg2-binary",
        "python-dotenv",
        "numpy",
    ],
)
