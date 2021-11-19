import time
import json
from download_scheduler.downloader_scheduler import get_a_download_job, run_download
from erddap_estimate.__main__ import estimate_query_size_per_dataset


if __name__ == "__main__":
    print("Waiting for jobs..")
    while True:
        row = get_a_download_job()
        if row:
            estimate=estimate_query_size_per_dataset(json.loads(row['downloader_input']))
            download_size_estimated=str(estimate.to_dict())

            pk = row["pk"]
            run_download(row,download_size_estimated)
            print("sleeping")
        time.sleep(0.5)
