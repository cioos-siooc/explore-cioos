import os
import shutil
from pathlib import Path

from cioos_downloader import download_erddap
from cioos_downloader.package import write_package
from cioos_downloader.zip_folder import zip_folder

# Each job works in ./<prefix><job_id>, removed when the job ends.
JOB_FOLDER_PREFIX = "cde_download_"


def run_download_query(download_query, output_folder):
    temp_folder = JOB_FOLDER_PREFIX + download_query["user_query"]["job_id"]

    # job_id is not unique across retries, so a crashed run may have left this.
    if os.path.exists(temp_folder):
        shutil.rmtree(temp_folder)
    os.makedirs(temp_folder)

    os.makedirs(output_folder, exist_ok=True)
    zip_full_path = os.path.join(output_folder, temp_folder + ".zip")

    try:
        query_report = download_erddap.get_datasets(download_query, temp_folder)
        # Zipped even with no data: the README tells the user why.
        write_package(Path(temp_folder), download_query, query_report)

        zip_folder(temp_folder, zip_full_path)

        query_report["zip_file_size"] = os.stat(zip_full_path).st_size
        query_report["path"] = zip_full_path
        return query_report
    except BaseException:
        # A half-written zip would be served at the job's download link.
        Path(zip_full_path).unlink(missing_ok=True)
        raise
    finally:
        shutil.rmtree(temp_folder, ignore_errors=True)
