#!/usr/bin/env python

from distutils.core import setup

setup(name='erddap_downloader',
      version='0.1',
      description='',
      url='',
      packages=['erddap_downloader'],
      install_requires=[
            'pandas',
            'erddapy',
            'shapely',
            'pdfkit'
      ]
      )
