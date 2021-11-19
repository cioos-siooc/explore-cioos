#!/bin/sh
cd ~/ceda
date
source virtualenv/bin/activate
sh data_loader.sh

sudo docker exec -it ceda_redis_1 redis-cli FLUSHALL
