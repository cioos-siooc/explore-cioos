import argparse
import json

from erddap_downloader import downloader_wrapper

# This file is just used for testing. In production downloader_wrapper.run_download_query is called by the download scheduler

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("json_query")

    parser.add_argument(
        "--create_pdf", dest="create_pdf", default=False, required=False
    )
    parser.add_argument(
        "--output_folder", dest="output_folder", default="out", required=False
    )

    args = parser.parse_args()
    json_query = args.json_query

    create_pdf = args.create_pdf
    output_folder = args.output_folder

    with open(json_query) as fid:
        download_query = json.load(fid)

    # Run download
    downloader_wrapper.run_download_query(
        download_query=download_query,
        output_folder=output_folder,
        create_pdf=create_pdf,
    )
