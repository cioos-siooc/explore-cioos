import os

from erddap_downloader import download_erddap
from erddap_downloader.zip_folder import zip_folder


def run_download_query(download_query, output_folder, create_pdf=False):
    temp_folder = "cde_download_" + download_query["user_query"]["job_id"]

    # create the temporary folder
    os.makedirs(temp_folder)

    # output_folder will never be created in production, just for development
    # in production, the zip file is saved to a web accessible folder
    os.makedirs(output_folder, exist_ok=True)

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

    # Delete temporary folder
    os.system("rm -rf {}".format(temp_folder))

    # Output run report json
    query_report["zip_file_size"] = os.stat(zip_full_path).st_size
    query_report["path"] = zip_full_path
    return query_report
