#!/bin/sh
date
cd /home/cioos/cde
docker-compose run harvester

docker exec -t cde-redis-1 redis-cli FLUSHALL
sh cde_refresh_cache.sh
docker exec -t cde-redis-1 redis-cli INFO | grep used_memory_human
docker exec -t cde-redis-1 redis-cli DBSIZE

date
