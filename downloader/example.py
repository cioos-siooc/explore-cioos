from erddap_downloader import download_erddap
from erddap_downloader import downloader_wrapper
import json 

with open('test/sample_blob.json','r') as fid:
    json_blob = json.load(fid)

downloader_wrapper.parallel_downloader(json_blob=json_blob, output_folder='./out/')