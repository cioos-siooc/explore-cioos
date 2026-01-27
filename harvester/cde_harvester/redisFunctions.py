from collections import Counter
import requests
import glob
import gzip
import redis
import traceback
from prefect.logging import get_run_logger
from prefect import flow, task
from datetime import datetime


@task(name="clear-redis-cache")
def clearRedisCache():
    logger = get_run_logger()
    
    ##TODO use env varibles here
    r = redis.Redis(host='redis', port=6379) # No need to specify db for flushall()
    # Clear all keys in all databases
    r.flushall()
    logger.info(f"redis cache flushed")
    
@task(name="reload-top-requests")
def reloadTopRequests():
    logger = get_run_logger()
    
    apiRequests = []
    log_files = sorted(glob.glob("/app/nginx/logs/access.log*"))
    for log_file in log_files:
        logger.info(f"Reading: {log_file}")
        # Handle both normal and gzipped logs
        if log_file.endswith(".gz"):
            open_func = gzip.open
            mode = "rt"  # text mode for gzip
        else:
            open_func = open
            mode = "r"
        
        with open_func(log_file, mode) as log:
            for line in log:
                try:
                    request = line.split(" ")[6]
                    if "/download" in request:
                        continue
                    elif "/api" in request:
                        apiRequests.append(request)
                except IndexError:
                    continue 
                    
    counts = Counter(apiRequests)
    result = [[count, item] for item, count in sorted(counts.items(), key=lambda x: x[1], reverse = True)]
    for apiRequest in result[0:4999]:
        try:
            logger.info(f"requesting: {apiRequest[1]}")
            r= requests.get("http://nginx:4000"+apiRequest[1])
            
        except:
            log.error("error while refreshing cache:\n")  
            log.error(traceback.format_exc())
            continue
            
@flow(name=f"refresh-redis")
def redisFlow():
    clearRedisCache()
    reloadTopRequests()
    

if __name__ == "__main__":
    redisFlow()
    


