import zipfile
import os

# From https://stackoverflow.com/questions/1855095/how-to-create-a-zip-archive-of-a-directory
def zip_folder(path, zip_full_path):
    ziph = zipfile.ZipFile(zip_full_path, "w", zipfile.ZIP_DEFLATED)

    # ziph is zipfile handle
    for root, dirs, files in os.walk(path):
        for file in files:
            res = ziph.write(
                os.path.join(root, file),
                os.path.relpath(os.path.join(root, file), os.path.join(path, "..")),
            )
            if res:
                raise Exception(
                    "Error creating zip file!", zip_full_path, " from files in ", path
                )

    ziph.close()
