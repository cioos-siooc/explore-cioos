import argparse
from erddap_downloader import downloader_wrapper
import json



if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("json_query")
    args = parser.parse_args()
    json_query = args.json_query

    with open(json_query) as fid:
        json_blob = json.load(fid)

    # Run query in parallel mode
    downloader_wrapper.parallel_downloader(json_blob=json_blob, output_folder='')
