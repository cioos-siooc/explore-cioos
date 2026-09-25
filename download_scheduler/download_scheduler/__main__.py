import time

from loguru import logger

from download_scheduler.download_scheduler import (
    forget_expired_emails,
    poll_once,
)

POLL_INTERVAL = 0.5
# Backoff used when the queue can't be read at all (database down), so the
# worker waits instead of hammering it every POLL_INTERVAL.
ERROR_BACKOFF = 5
FORGET_EMAILS_INTERVAL = 60 * 60

if __name__ == "__main__":
    logger.debug("Waiting for jobs..")
    last_forget = float("-inf")
    while True:
        if time.monotonic() - last_forget >= FORGET_EMAILS_INTERVAL:
            forget_expired_emails()
            last_forget = time.monotonic()
        serving = poll_once()
        time.sleep(POLL_INTERVAL if serving else ERROR_BACKOFF)
