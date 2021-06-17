from erddap_downloader import downloader_wrapper
import json
import sys

if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise Exception(
            "Insufficient inputs. Include json filename with path and pdf option[y/n]"
        )

    json_file = sys.argv[1]
    pdf_option = sys.argv[2]
    with open(json_file, "r") as fid:
        json_blob = json.load(fid)

    json_blob["create_pdf"] = pdf_option.upper() == "Y"
    if json_blob.get("output_folder_name") is None:
        output_folder_name = "./out/"

    print(
        downloader_wrapper.parallel_downloader(
            json_blob=json_blob, output_folder=output_folder_name
        )
    )
