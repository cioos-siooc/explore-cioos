import os
import shutil

from erddap_downloader import download_erddap
from erddap_downloader.zip_folder import zip_folder


def run_download_query(download_query, output_folder, create_pdf=False):
    temp_folder = "cde_download_" + download_query["user_query"]["job_id"]

    # Start from a clean temp folder. The name is derived from job_id (not
    # unique across retries), so a previous run that died before its cleanup
    # could have left one behind — which would otherwise FileExistsError here.
    if os.path.exists(temp_folder):
        shutil.rmtree(temp_folder)
    os.makedirs(temp_folder)

    # output_folder will never be created in production, just for development
    # in production, the zip file is saved to a web accessible folder
    os.makedirs(output_folder, exist_ok=True)

    try:
        # Run the download
        query_report = download_erddap.get_datasets(download_query, temp_folder, create_pdf)

        # check if no data returned, exit early
        if query_report["empty_download"]:
            query_report["zip_file_size"] = 0
            return query_report

        # Zip the download
        zip_filename = temp_folder + ".zip"
        zip_full_path = os.path.join(output_folder, zip_filename)

        zip_folder(temp_folder, zip_full_path)

        # Output run report json
        query_report["zip_file_size"] = os.stat(zip_full_path).st_size
        query_report["path"] = zip_full_path
        return query_report
    finally:
        # Always remove the temp folder, even if get_datasets/zip raised, so a
        # failed run can't orphan it and break the next run with the same job_id.
        shutil.rmtree(temp_folder, ignore_errors=True)
