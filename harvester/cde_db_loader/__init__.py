"""Deprecated compatibility shim.

The db-loader was merged into the harvester package: the code now lives at
``cde_harvester.loading``. This shim keeps ``python -m cde_db_loader`` and
``cde_db_loader.*`` imports working for one deploy cycle — delete it once no
crontab/operator invocation uses the old path.
"""
