import pdfkit
from multiprocessing import Process
from . import download_erddap
import os
import random

import uuid


def gen_folder_name(fpath="../"):
    # generate foldernames until you generate one that doesnt exist
    def gen_string(n=10):
        random_string = ""
        for _ in range(n):
            # Considering only upper and lowercase letters
            random_integer = random.randint(97, 97 + 26 - 1)
            random_string += chr(random_integer)
        return random_string

    while True:
        fname = gen_string(10)
        if not os.path.exists(os.path.join(fpath, fname)):
            break
    return os.path.join(fpath, fname)


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
    # output_folder = gen_folder_name(fpath=output_folder)
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
        ckan_filename = os.path.join(
            temp_folder,
            "{}_{}.pdf".format(
                filtered_result["dataset_id"],
                erddap_url.split("/")[2].replace(".", "_"),
            ),
        )
        if create_pdf:
            print("creating pdf file ...")
            pid = Process(
                target=download_ckan_pdf,
                args=(ckan_url, ckan_id, ckan_filename),
            )
            pid.start()
            pid.join()

        # call jessy's code here to download data from erddap
        blob = json_blob
        blob["cache_filtered"] = [filtered_result]
        pid = Process(
            target=download_erddap.get_dataset, args=(blob, temp_folder)
        )
        pid.start()
        pid.join()
    # zip files in folder
        zip_full_path = os.path.join(output_folder,zip_filename)
        print("Writing zip ",zip_full_path)
        retval = os.system(
            "zip -r {} {}".format(zip_full_path, temp_folder)
        )
        
        if retval == 0:
            os.system("rm -rf {}".format(temp_folder))
        else:
            raise Exception("Error creating zip file!", zip_full_path, " from files in ", temp_folder)
    return zip_filename
