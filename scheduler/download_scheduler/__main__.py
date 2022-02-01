import time
import json
from download_scheduler.downloader_scheduler import get_a_download_job, run_download
from scraper.erddap_estimate.__main__ import estimate_query_size_per_dataset
import traceback


if __name__ == "__main__":
    print("Waiting for jobs..")
    while True:
        row = get_a_download_job()
        if row:
            try:
                estimate=estimate_query_size_per_dataset(json.loads(row['downloader_input']))
                download_size_estimated=str(estimate.to_dict())
            except Exception as e:
                stack_trace=traceback.format_exc()
                download_size_estimated=str(stack_trace).replace("'", "")
                print(stack_trace)
                
            pk = row["pk"]
            run_download(row,download_size_estimated)
            print("sleeping")
        time.sleep(0.5)
