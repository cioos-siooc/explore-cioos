#!/usr/bin/env python3
"""
Main Prefect flow that orchestrates cde_harvester and cde_db_loader as subflows.
"""
import argparse
import logging
import os
import sys

import yaml
from dotenv import load_dotenv
from prefect import flow, get_run_logger

# Import the existing flows
from cde_harvester.__main__ import main as harvester_main, setup_logging, load_config
from cde_harvester.redisFunctions import redisFlow

# Import db_loader main - need to handle module path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'db-loader'))
from cde_db_loader.__main__ import main as db_loader_main

load_dotenv()

logger = logging.getLogger(__name__)


@flow(name="cde-pipeline", log_prints=True)
def cde_pipeline(config_file=None):
    """
    Main Prefect flow that runs cde_harvester and cde_db_loader as subflows.
    
    Args:
        config_file: Path to harvest_config.yaml

    """
    logger = get_run_logger()
    logger.info("Starting CDE Pipeline")
    
    # Load configuration - config_file is required for deployment
    if not config_file:
        raise ValueError("config_file is required")
    
    config = load_config(config_file)
    logger.info(f"Using config from {config_file}")
    
    # Extract harvester config
    erddap_urls = ",".join(config.get("erddap_urls") or [])
    cache_requests = config.get("cache", False)
    folder = config.get("folder") or "harvest"
    max_workers = config.get("max-workers", 1)
    dataset_ids = ",".join(config.get("dataset_ids") or [])
    log_time = config.get("log_time", False)
    log_level = config.get("log_level", "INFO")
    log_dir = os.environ.get("HARVESTER_LOG_DIR") or config.get("log_dir")
    # Use config file's incremental setting if parameter is False
    incremental = config.get("incremental", False)
    flush_redis = config.get("flush_redis", False)
    # Run harvester as a subflow
    logger.info("Running cde_harvester subflow")
    try:
        harvester_main(
            erddap_urls=erddap_urls,
            cache_requests=cache_requests,
            folder=folder,
            dataset_ids=dataset_ids,
            max_workers=max_workers
        )
        logger.info("cde_harvester completed successfully")
    except Exception as e:
        logger.error(f"cde_harvester failed: {e}", exc_info=True)
        raise
    
    # Run db_loader as a subflow
    logger.info("Running cde_db_loader subflow")
    try:
        db_loader_main(folder=folder, incremental=incremental)
        logger.info("cde_db_loader completed successfully")
    except Exception as e:
        logger.error(f"cde_db_loader failed: {e}", exc_info=True)
        raise
    
    # Run redis refresh as a subflow
    logger.info("Running redisFlow subflow")
    if flush_redis:
        try:
        
            redisFlow()
            logger.info("redisFlow completed successfully")
        except Exception as e:
            logger.error(f"redisFlow failed: {e}", exc_info=True)
            raise
    
    logger.info("CDE Pipeline completed successfully")



if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Run CDE harvester and db_loader as Prefect subflows"
    )
    
    parser.add_argument(
        "-f",
        "--file",
        help="Path to harvest_config.yaml file",
        default=None
    )
    

    

    
    args = parser.parse_args()
    
    try:
        if args.file:
            cde_pipeline(config_file=args.file)
        else:
            logger.error("Use -f or --file to specify harvest_config.yaml")
            sys.exit(1)
    except Exception as e:
        logger.error("Pipeline failed", exc_info=True)
        sys.exit(1)

