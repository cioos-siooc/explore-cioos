import time

from download_scheduler.download_scheduler import (get_a_download_job,
                                                   run_download)

if __name__ == "__main__":
    print("Waiting for jobs..")
    while True:
        row = get_a_download_job()
        if row:
            pk = row["pk"]
            run_download(row)
            print("sleeping")
        time.sleep(0.5)
