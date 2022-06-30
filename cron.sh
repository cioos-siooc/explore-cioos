#!/bin/sh
cd ~/cde
date
sh data_loader.sh

sudo docker exec -t cde_redis_1 redis-cli FLUSHALL
sh refresh_cache.sh
sudo docker exec -t cde_redis_1 redis-cli INFO | grep used_memory_human
sudo docker exec -t cde_redis_1 redis-cli DBSIZE

date
