#!/usr/bin/env python3
"""
Main Prefect pipeline: runs one harvest_server_flow subflow per ERDDAP server,
all concurrently, then optionally refreshes Redis.
"""
import argparse
import logging
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

from dotenv import load_dotenv
from prefect import flow, get_run_logger

from cde_harvester.__main__ import harvest_server_flow, load_config, setup_logging
from cde_harvester.redisFunctions import redisFlow

load_dotenv()

logger = logging.getLogger(__name__)


@flow(name="cde-pipeline", log_prints=True)
def cde_pipeline(config_file=None):
    """
    Main Prefect flow. For each ERDDAP URL in config, runs a harvest_server_flow
    subflow concurrently. Each subflow harvests the server, processes the data,
    and uploads to the DB independently.
    """
    flow_logger = get_run_logger()

    if not config_file:
        raise ValueError("config_file is required")

    config = load_config(config_file)
    flow_logger.info("Using config from %s", config_file)

    erddap_urls = config.get("erddap_urls") or []
    cache_requests = config.get("cache", False)
    folder = config.get("folder") or "harvest"
    dataset_ids = ",".join(config.get("dataset_ids") or [])
    flush_redis = config.get("flush_redis", False)
    log_time = config.get("log_time", False)
    log_level = config.get("log_level", "INFO")
    log_dir = os.environ.get("HARVESTER_LOG_DIR") or config.get("log_dir")

    setup_logging(log_time, log_level, log_dir)

    if not erddap_urls:
        flow_logger.error("No erddap_urls found in config")
        return

    flow_logger.info("Starting pipeline for %d ERDDAP server(s)", len(erddap_urls))

    with ThreadPoolExecutor() as executor:
        futures = {
            executor.submit(
                harvest_server_flow, url, folder, cache_requests, dataset_ids
            ): url
            for url in erddap_urls
        }
        for future in as_completed(futures):
            url = futures[future]
            try:
                future.result()
                flow_logger.info("Completed: %s", url)
            except Exception as e:
                flow_logger.error("Failed: %s — %s", url, e, exc_info=True)

    if flush_redis:
        flow_logger.info("Refreshing Redis cache")
        try:
            redisFlow()
        except Exception as e:
            flow_logger.error("redisFlow failed: %s", e, exc_info=True)

    flow_logger.info("CDE Pipeline completed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Run CDE harvester pipeline as Prefect flows"
    )
    parser.add_argument(
        "-f", "--file",
        help="Path to harvest_config.yaml",
        required=True,
    )
    args = parser.parse_args()

    try:
        cde_pipeline(config_file=args.file)
    except Exception:
        logger.error("Pipeline failed", exc_info=True)
        sys.exit(1)
