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
        warnings.warn("Error creating PDF", e, traceback.format_exc())
