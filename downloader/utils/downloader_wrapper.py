import pdfkit
import json

def download_ckan_pdf(ckan_url='https://catalogue.cioospacific.ca/dataset/', ckan_id='f239e86c-38d1-4fb2-8b17-acaed794221c', 
                        pdf_filename='ckan.pdf'):
    download_url = ckan_url+ckan_id
    if pdfkit.from_url(download_url, pdf_filename):
        return 0
    else:
        raise Exception("Unable to download file")



def parallel_downloader(json_blob=None, output_folder='../'):
    pass



if __name__ == "__main__":
    with open('sample_blob.json','r') as fid:
        json_blob = json.load(fid)
    print(json_blob)