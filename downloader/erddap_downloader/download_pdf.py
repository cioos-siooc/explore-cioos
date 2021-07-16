import pdfkit
import warnings
import traceback
import os


def download_pdf(url, filename):
    print("creating pdf file ", filename)

    config = pdfkit.configuration()

    try:
        if pdfkit.from_url(url, filename, configuration=config):
            return 0
        else:
            raise Exception("Unable to download file")
    except Exception as e:
        print(e)
        print(traceback.format_exc())
        warnings.warn("Error creating PDF")
