#!/usr/bin/env python

from distutils.core import setup

setup(
    name="download_scheduler",
    version="0.1",
    description="",
    url="",
    packages=["download_scheduler"],
    install_requires=["sqlalchemy", "psycopg2-binary", "sentry-sdk", "python-dotenv"],
)
