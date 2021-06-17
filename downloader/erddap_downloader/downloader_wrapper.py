import pdfkit
from multiprocessing import Process
from . import download_erddap
import os
import random
import zipfile


if os.name == "nt":
    path_wkthmltopdf = b"C:\Program Files\wkhtmltopdf\\bin\wkhtmltopdf.exe"
    config = pdfkit.configuration(wkhtmltopdf=path_wkthmltopdf)
else:
    config = pdfkit.configuration()


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
    download_url = ckan_url + ckan_id
    if pdfkit.from_url(download_url, pdf_filename, configuration=config):
        return 0
    else:
        raise Exception("Unable to download file")


def parallel_downloader(json_blob=None, output_folder="./"):
    # output_folder = gen_folder_name(fpath=output_folder)
    full_output_path = os.path.join(
        output_folder,
        json_blob["user_query"].get("zip_file_name").replace(".zip", ""),
    )
    print(full_output_path)
    if not os.path.exists(full_output_path):
        os.makedirs(full_output_path)

    for filtered_result in json_blob["cache_filtered"]:
        erddap_url = filtered_result["erddap_url"]
        ckan_url = filtered_result["ckan_url"]
        ckan_id = filtered_result["ckan_id"]
        ckan_filename = os.path.join(
            full_output_path,
            "{}_{}.pdf".format(
                filtered_result["dataset_id"],
                erddap_url.split("/")[2].replace(".", "_"),
            ),
        )
        if json_blob.get("create_pdf", None) is True:
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
            target=download_erddap.get_dataset, args=(blob, full_output_path)
        )
        pid.start()
        pid.join()
    # zip files in folder
    if os.name != "nt":
        retval = os.system(
            "zip -r {}.zip {}".format(full_output_path, full_output_path)
        )
        if retval == 0:
            os.system("rm -f {}/*".format(full_output_path))
        else:
            raise Exception("Error creating zip file!")
    return "{}.zip".format(full_output_path)
