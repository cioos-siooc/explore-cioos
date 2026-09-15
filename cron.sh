#!/bin/sh
# STALE — reconcile with the prod host's crontab before trusting this file.
# It has not been touched since 2024-05-27 ("match pac-prod2 cron.sh") and
# still names a `harvester` compose service and `cde-redis-1` containers that
# this repo no longer defines. Harvests run through Prefect now
# (harvester/cde_harvester/prefect_pipeline.py). See TODO-cde-revisions.md.
date
cd /home/cioos/cde
docker-compose run harvester

# The cache flush and warm-up used to live here, unconditionally: every run
# wiped redis whether or not the harvest changed anything, and `sh
# cde_refresh_cache.sh` invoked a script that does not exist in this repo. The
# pipeline owns both now, and only flushes when the load actually changed data
# (prefect_pipeline.py -> clearRedisCache + reloadTopRequests).
docker exec -t cde-redis-1 redis-cli INFO | grep used_memory_human
docker exec -t cde-redis-1 redis-cli DBSIZE

date
