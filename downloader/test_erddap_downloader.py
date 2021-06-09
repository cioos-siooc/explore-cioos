from erddap_downloader import download_erddap
import json
output_path = "./"

with open('test_query.json', 'r') as f:
    query_json = json.load(f)

download_erddap.get_dataset(query_json, output_path)




