import glob
import gzip
import math
import os
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta

import redis
import requests
from prefect import task
from prefect.logging import get_run_logger

# Compose network, not the public domain: avoids going out through the WAF.
CACHE_WARM_BASE_URL = os.environ.get("CACHE_WARM_BASE_URL", "http://nginx:4000")
CACHE_WARM_TIMEOUT_SECONDS = 60
# Serially, 5000 routes at ~100ms each takes 8+ minutes.
CACHE_WARM_CONCURRENCY = int(os.environ.get("CACHE_WARM_CONCURRENCY", "8"))
CACHE_WARM_MAX_ROUTES = 5000

# What a first visitor's browser requests with default filters (frontend
# FilterProvider, MapStateProvider, CoverageModal), byte-for-byte: apicache
# keys on the exact URL. Warmed even when there are no access logs to replay.
DEFAULT_VIEW_ROUTES = [
    "/api/platforms",
    "/api/oceanVariables",
    "/api/organizations",
    "/api/obisNodes",
    "/api/datasets",
    "/api/erddapServers",
    "/api/timeExtent",
    "/api/pointQuery",
    "/api/legend?metric=days",
    "/api/coverageHistogram?groupBy=source&count=days&view=timeline&",
]
# The default view (zoom 2.75) loads z2 tiles; z0-z3 is the whole world for
# zooming out and one level in, 85 tiles per source.
DEFAULT_VIEW_MAX_TILE_ZOOM = 3
# Zooming in on North America (~1k tiles per source through z6) stays warm.
NORTH_AMERICA_BBOX = (-170.0, 15.0, -50.0, 84.0)  # west, south, east, north
NORTH_AMERICA_MAX_TILE_ZOOM = 6
# frontend defaultTrailingDays; the track window ends on today's UTC date.
DEFAULT_TRAILING_DAYS = 90

# Same env contract as web-api/utils/redis.js.
REDIS_URL = os.environ.get("REDIS_URL")
REDIS_HOST = os.environ.get("REDIS_HOST", "redis")
REDIS_PORT = int(os.environ.get("REDIS_PORT", "6379"))
REDIS_PASSWORD = os.environ.get("REDIS_PASSWORD") or None
REDIS_TLS = os.environ.get("REDIS_TLS", "").lower() == "true"


def _redis_client():
    # No db index: flushall covers every database anyway.
    if REDIS_URL:
        return redis.Redis.from_url(REDIS_URL)
    return redis.Redis(
        host=REDIS_HOST, port=REDIS_PORT, password=REDIS_PASSWORD, ssl=REDIS_TLS
    )


@task(name="clear-redis-cache")
def clearRedisCache():
    logger = get_run_logger()

    _redis_client().flushall()
    logger.info("redis cache flushed")

def _world_tiles(max_zoom):
    for z in range(max_zoom + 1):
        for x in range(2**z):
            for y in range(2**z):
                yield z, x, y


def _bbox_tiles(min_zoom, max_zoom, bbox):
    west, south, east, north = bbox

    def tile_y(lat, n):
        lat = math.radians(lat)
        return int((1 - math.asinh(math.tan(lat)) / math.pi) / 2 * n)

    for z in range(min_zoom, max_zoom + 1):
        n = 2**z
        for x in range(int((west + 180) / 360 * n), int((east + 180) / 360 * n) + 1):
            for y in range(tile_y(north, n), tile_y(south, n) + 1):
                yield z, x, y


def default_view_routes(today: date):
    # Same window as the frontend's tracksTimeWindow(), URLSearchParams-encoded.
    time_min = (today - timedelta(days=DEFAULT_TRAILING_DAYS)).isoformat()
    time_max = (today + timedelta(days=1)).isoformat()
    tracks_query = f"timeMin={time_min}T00%3A00%3A00Z&timeMax={time_max}T00%3A00%3A00Z"
    tiles = [
        *_world_tiles(DEFAULT_VIEW_MAX_TILE_ZOOM),
        *_bbox_tiles(
            DEFAULT_VIEW_MAX_TILE_ZOOM + 1,
            NORTH_AMERICA_MAX_TILE_ZOOM,
            NORTH_AMERICA_BBOX,
        ),
    ]
    return [
        *DEFAULT_VIEW_ROUTES,
        *(f"/api/tiles/{z}/{x}/{y}.mvt?metric=days" for z, x, y in tiles),
        *(f"/api/tiles/tracks/{z}/{x}/{y}.mvt?{tracks_query}" for z, x, y in tiles),
    ]


@task(name="reload-top-requests")
def reloadTopRequests():
    logger = get_run_logger()

    apiRequests = []
    log_files = sorted(glob.glob("/app/nginx/logs/access.log*"))
    for log_file in log_files:
        # The stock nginx image links access.log to /dev/stdout; opened here
        # that is this process's own stdout pipe and the read never returns.
        if not os.path.isfile(log_file):
            logger.warning(f"Skipping non-regular log file: {log_file}")
            continue
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

    # Defaults first so a first visitor is covered soonest; dict dedupes in order.
    routes = list(dict.fromkeys([
        *default_view_routes(datetime.now(UTC).date()),
        *(request for request, _count in Counter(apiRequests).most_common(
            CACHE_WARM_MAX_ROUTES
        )),
    ]))

    def warm(request):
        # `logger` is closed over: get_run_logger() reads a thread-local
        # Prefect run context that worker threads do not have.
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
        warmed = sum(pool.map(warm, routes))
    logger.info("Warmed %d of %d route(s)", warmed, len(routes))

def redisFlow():
    clearRedisCache()
    reloadTopRequests()


if __name__ == "__main__":
    redisFlow()
