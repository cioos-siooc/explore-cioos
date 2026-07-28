"""Database loading for the CDE pipeline.

Takes the CSV files written by a harvest run and loads them into the
PostgreSQL ``cde`` schema. See ``loader.py`` for the two load modes
(full reload vs incremental) and README.md in this package for usage.
"""

from cde_harvester.loading.loader import main as db_loader_main

__all__ = ["db_loader_main"]
