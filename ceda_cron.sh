#!/bin/sh
cd ~/ceda
date
source venv/bin/activate
sh data_loader.sh

sudo docker exec -it ceda_redis_1 redis-cli FLUSHALL
