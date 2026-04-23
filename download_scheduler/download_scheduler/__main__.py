import time

from loguru import logger

from download_scheduler.download_scheduler import get_a_download_job, run_download
from download_scheduler.health_server import start_health_server

if __name__ == "__main__":
    start_health_server(port=8000)
    logger.debug("Waiting for jobs..")
    while True:
        row = get_a_download_job()
        if row:
            pk = row["pk"]
            run_download(row)
            logger.debug("sleeping")
        time.sleep(0.5)
