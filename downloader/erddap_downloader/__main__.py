import argparse
from erddap_downloader import downloader_wrapper
import json


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("json_query")
    
    parser.add_argument('--create_pdf', dest='create_pdf',default=False,required=False)
    parser.add_argument('--output_folder', dest='output_folder',default='out',required=False)

    args = parser.parse_args()
    json_query = args.json_query
    
    create_pdf = args.create_pdf
    output_folder = args.output_folder

    with open(json_query) as fid:
        json_blob = json.load(fid)

    # Run query in parallel mode
    downloader_wrapper.parallel_downloader(
        json_blob=json_blob,
        output_folder=output_folder,
        create_pdf=create_pdf
    )
