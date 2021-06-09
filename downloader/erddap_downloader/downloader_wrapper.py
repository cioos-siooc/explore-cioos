import pdfkit
import json
from multiprocessing import Process


def download_ckan_pdf(ckan_url=None, ckan_id=None, pdf_filename=None):
    download_url = ckan_url+ckan_id
    if pdfkit.from_url(download_url, pdf_filename):
        return 0
    else:
        raise Exception("Unable to download file")



def parallel_downloader(json_blob=None, output_folder='../'):
    for filtered_result in json_blob['cache_filtered']:
        erddap_url = filtered_result['erddap_url']
        ckan_url = filtered_result['ckan_url']
        ckan_id = filtered_result['ckan_id']
        ckan_filename = '{}{}_{}.pdf'.format(output_folder, filtered_result['dataset_id'], erddap_url.split('/')[2].replace('.','_') )
        pid = Process(target=download_ckan_pdf, args=(ckan_url, ckan_id, ckan_filename))
        pid.start()
        pid.join()

        # call jessy's code here to download data from erddap




if __name__ == "__main__":
    with open('sample_blob.json','r') as fid:
        json_blob = json.load(fid)
    parallel_downloader(json_blob=json_blob, output_folder='./')

    
