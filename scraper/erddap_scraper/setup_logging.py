#!/usr/bin/env python3

import logging


def setup_logging():
    'Setup logging'
    logger = logging.getLogger(__name__)

    logging.basicConfig(
        format='%(asctime)s %(levelname)-8s %(message)s'
    )

    logging.getLogger().setLevel(logging.INFO)
    return logger
