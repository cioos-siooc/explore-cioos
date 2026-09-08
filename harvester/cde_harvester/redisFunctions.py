import glob
import gzip
import os
from collections import Counter

import redis
import requests
from prefect import task
from prefect.logging import get_run_logger

# The API is warmed over the compose network, not the public domain — the point
# is to populate Redis behind nginx without going out and back through the WAF.
# Overridable so a non-compose deployment can point at its own ingress.
CACHE_WARM_BASE_URL = os.environ.get("CACHE_WARM_BASE_URL", "http://nginx:4000")
CACHE_WARM_TIMEOUT_SECONDS = 60


@task(name="clear-redis-cache")
def clearRedisCache():
    logger = get_run_logger()

    ##TODO use env varibles here
    r = redis.Redis(host='redis', port=6379) # No need to specify db for flushall()
    # Clear all keys in all databases
    r.flushall()
    logger.info("redis cache flushed")

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
    for _count, request in result[0:4999]:
        # The response body is deliberately discarded: the side effect of the
        # request — the API populating Redis — is the whole point. A request
        # that fails only means that one route stays cold, so log it and warm
        # the rest. (This handler used to be a bare `except:` calling
        # `log.error`, where `log` was the closed log-file handle from the loop
        # above, so every failure raised AttributeError out of the task.)
        logger.info(f"requesting: {request}")
        try:
            response = requests.get(
                CACHE_WARM_BASE_URL + request, timeout=CACHE_WARM_TIMEOUT_SECONDS
            )
            response.raise_for_status()
        except requests.RequestException:
            logger.exception(f"error while refreshing cache for {request}")

def redisFlow():
    """Plain helper for the standalone CLI below; the pipeline calls the two
    tasks directly. No longer a @flow (avoids a ceremony subflow box)."""
    clearRedisCache()
    reloadTopRequests()


if __name__ == "__main__":
    redisFlow()
