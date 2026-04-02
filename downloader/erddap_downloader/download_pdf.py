import pdfkit
from loguru import logger


def download_pdf(url, filename):
    logger.info("Creating PDF file {}", filename)

    config = pdfkit.configuration()

    try:
        if not pdfkit.from_url(url, filename, configuration=config):
            raise Exception("Unable to download file")
    except Exception as e:
        logger.error("Error creating PDF from {}: {}", url, e)
