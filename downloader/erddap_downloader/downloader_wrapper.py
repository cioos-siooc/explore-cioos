import os
import shutil
from pathlib import Path

from erddap_downloader import download_erddap
from erddap_downloader.package import write_package
from erddap_downloader.zip_folder import zip_folder


def run_download_query(download_query, output_folder):
    temp_folder = "cde_download_" + download_query["user_query"]["job_id"]

    # job_id is not unique across retries, so a crashed run may have left this.
    if os.path.exists(temp_folder):
        shutil.rmtree(temp_folder)
    os.makedirs(temp_folder)

    os.makedirs(output_folder, exist_ok=True)

    try:
        query_report = download_erddap.get_datasets(download_query, temp_folder)
        # Zipped even with no data: the README tells the user why.
        write_package(Path(temp_folder), download_query, query_report)

        zip_full_path = os.path.join(output_folder, temp_folder + ".zip")
        zip_folder(temp_folder, zip_full_path)

        query_report["zip_file_size"] = os.stat(zip_full_path).st_size
        query_report["path"] = zip_full_path
        return query_report
    finally:
        shutil.rmtree(temp_folder, ignore_errors=True)
