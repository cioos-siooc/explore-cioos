from erddap_downloader import download_erddap
from erddap_downloader import downloader_wrapper
import json 

if __name__ == "__main__":
    with open('test/test_multiple_dataset_query.json','r') as fid:
        json_blob = json.load(fid)

# print(downloader_wrapper.gen_folder_name())
downloader_wrapper.parallel_downloader(json_blob=json_blob, output_folder='./out/')