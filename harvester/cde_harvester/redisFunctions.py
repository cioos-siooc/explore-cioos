import glob
import gzip
import os
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

import redis
import requests
from prefect import task
from prefect.logging import get_run_logger

# The API is warmed over the compose network, not the public domain — the point
# is to populate Redis behind nginx without going out and back through the WAF.
# Overridable so a non-compose deployment can point at its own ingress.
CACHE_WARM_BASE_URL = os.environ.get("CACHE_WARM_BASE_URL", "http://nginx:4000")
CACHE_WARM_TIMEOUT_SECONDS = 60
# Warm in parallel: this used to be a serial loop over up to 5000 routes, which
# at even 100ms each runs past 8 minutes — longer than the cache entries used to
# live, so the earliest-warmed routes had already expired by the time it
# finished. The TTL is long now (see DEFAULT_CACHE_DURATION in
# web-api/utils/routePipeline.js), but finishing promptly still means the site
# is warm sooner after a harvest, and keeps the window where a visitor races
# the warm-up short.
CACHE_WARM_CONCURRENCY = int(os.environ.get("CACHE_WARM_CONCURRENCY", "8"))
CACHE_WARM_MAX_ROUTES = 5000

# Same env contract as web-api/utils/redis.js, so one set of variables points
# both halves of the cache — the writer (the API) and this, its invalidator —
# at the same instance. Previously hardcoded to host='redis'.
REDIS_URL = os.environ.get("REDIS_URL")
REDIS_HOST = os.environ.get("REDIS_HOST", "redis")
REDIS_PORT = int(os.environ.get("REDIS_PORT", "6379"))
REDIS_PASSWORD = os.environ.get("REDIS_PASSWORD") or None


def _redis_client():
    # No db index: flushall covers every database anyway.
    if REDIS_URL:
        return redis.Redis.from_url(REDIS_URL)
    return redis.Redis(host=REDIS_HOST, port=REDIS_PORT, password=REDIS_PASSWORD)


@task(name="clear-redis-cache")
def clearRedisCache():
    logger = get_run_logger()

    _redis_client().flushall()
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

    # most_common already dedupes and orders by hit count — the routes real
    # visitors ask for most are the ones worth having warm.
    routes = [request for request, _count in Counter(apiRequests).most_common(
        CACHE_WARM_MAX_ROUTES
    )]

    def warm(request):
        # The response body is deliberately discarded: the side effect of the
        # request — the API populating Redis — is the whole point. A request
        # that fails only means that one route stays cold, so log it and warm
        # the rest. (This handler used to be a bare `except:` calling
        # `log.error`, where `log` was the closed log-file handle from the loop
        # above, so every failure raised AttributeError out of the task.)
        #
        # `logger` is closed over rather than fetched here: get_run_logger()
        # reads a thread-local Prefect run context that worker threads do not
        # have.
        try:
            response = requests.get(
                CACHE_WARM_BASE_URL + request, timeout=CACHE_WARM_TIMEOUT_SECONDS
            )
            response.raise_for_status()
            return True
        except requests.RequestException:
            logger.exception(f"error while refreshing cache for {request}")
            return False

    logger.info(
        "Warming %d route(s) with %d workers", len(routes), CACHE_WARM_CONCURRENCY
    )
    with ThreadPoolExecutor(max_workers=CACHE_WARM_CONCURRENCY) as pool:
        # Per-request success logging would be up to 5000 lines into the Prefect
        # run; the failures above are the part worth reading.
        warmed = sum(pool.map(warm, routes))
    logger.info("Warmed %d of %d route(s)", warmed, len(routes))

def redisFlow():
    """Plain helper for the standalone CLI below; the pipeline calls the two
    tasks directly. No longer a @flow (avoids a ceremony subflow box)."""
    clearRedisCache()
    reloadTopRequests()


if __name__ == "__main__":
    redisFlow()
