import pdfkit
from multiprocessing import Process
from . import download_erddap
import os
import uuid
import zipfile


def download_ckan_pdf(ckan_url=None, ckan_id=None, pdf_filename=None):
    if os.name == "nt":
        path_wkthmltopdf = b"C:\Program Files\wkhtmltopdf\\bin\wkhtmltopdf.exe"
        config = pdfkit.configuration(wkhtmltopdf=path_wkthmltopdf)
    else:
        config = pdfkit.configuration()

    download_url = ckan_url + ckan_id
    if pdfkit.from_url(download_url, pdf_filename, configuration=config):
        return 0
    else:
        raise Exception("Unable to download file")


def parallel_downloader(json_blob=None, output_folder="", create_pdf=False):
    temp_folder= 'ceda_download_' + str(uuid.uuid4())[0:6]
    zip_filename=json_blob["user_query"]["zip_filename"]
    
    # crash on UUID collision
    os.makedirs(temp_folder)
    
    # output_folder will never be created in production, just for development
    os.makedirs(output_folder,exist_ok=True)
    
    for filtered_result in json_blob["cache_filtered"]:
        erddap_url = filtered_result["erddap_url"]
        ckan_url = filtered_result["ckan_url"]
        ckan_id = filtered_result["ckan_id"]
        
        if create_pdf:
            ckan_filename = os.path.join(
                temp_folder,
                "{}_{}.pdf".format(
                    filtered_result["dataset_id"],
                    erddap_url.split("/")[2].replace(".", "_"),
                ),
            )
            print("creating pdf file ...")
            download_ckan_pdf(ckan_url, ckan_id, ckan_filename)
            
        download_erddap.get_dataset(json_blob, temp_folder)
        # call jessy's code here to download data from erddap

    # Review if temp_folder has files in it
    if os.listdir(temp_folder) == []:
        return 0

    # Zip files in temporary folder
    zip_full_path = os.path.join(output_folder,zip_filename)
    print("Writing zip ",zip_full_path)
    zip_fid = zipfile.ZipFile(zip_full_path, "w", compression=zipfile.ZIP_DEFLATED)
    # walk the path and zip all files
    for dirname, subdirs, files in os.walk(temp_folder):
        for filename in files:
            print('compressing...',dirname, filename)
            retval = zip_fid.write(filename=os.path.join(dirname,filename), arcname=filename)
    zip_fid.close()

    # Create an error if failed to zipped file            
    if retval:
        raise Exception("Error creating zip file!", zip_full_path, " from files in ", temp_folder)
    

    # Delete temporary folder
    os.system("rm -rf {}".format(temp_folder))
    
    # Output zipped file size and return zipped file size in bytes
    return os.stat(zip_full_path).st_size
