import time

from loguru import logger

from download_scheduler.download_scheduler import poll_once

POLL_INTERVAL = 0.5
# Backoff used when the queue can't be read at all (database down), so the
# worker waits instead of hammering it every POLL_INTERVAL.
ERROR_BACKOFF = 5

if __name__ == "__main__":
    logger.debug("Waiting for jobs..")
    while True:
        serving = poll_once()
        time.sleep(POLL_INTERVAL if serving else ERROR_BACKOFF)
