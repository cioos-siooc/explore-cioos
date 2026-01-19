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
def cde_pipeline(config_file=None, redis_only=False, **kwargs):
    """
    Main Prefect flow that runs cde_harvester and cde_db_loader as subflows.
    
    Args:
        config_file: Path to harvest_config.yaml
        redis_only: If True, only run the redisFlow subflow
        **kwargs: Additional arguments that override config file settings
    """
    logger = get_run_logger()
    logger.info("Starting CDE Pipeline")
    
    # Load configuration
    if config_file:
        config = load_config(config_file)
        logger.info(f"Using config from {config_file}")
        
        # Extract harvester config
        erddap_urls = ",".join(config.get("erddap_urls") or [])
        cache_requests = config.get("cache", False)
        folder = config.get("folder") or "harvest"  # Ensure folder is never None
        max_workers = config.get("max-workers", 1)
        dataset_ids = ",".join(config.get("dataset_ids") or [])
        log_time = config.get("log_time", False)
        log_level = config.get("log_level", "INFO")
        log_dir = os.environ.get("HARVESTER_LOG_DIR") or config.get("log_dir")
        incremental = config.get("incremental", False)
    else:
        # Use kwargs for configuration
        erddap_urls = kwargs.get("erddap_urls", "")
        cache_requests = kwargs.get("cache", False)
        folder = kwargs.get("folder", "harvest")
        max_workers = kwargs.get("max_workers", 1)
        dataset_ids = kwargs.get("dataset_ids", "")
        log_time = kwargs.get("log_time", False)
        log_level = kwargs.get("log_level", "INFO")
        log_dir = kwargs.get("log_dir", None)
        incremental = kwargs.get("incremental", False)
    
    # Setup logging (only for non-Prefect loggers)
    if not redis_only:
        setup_logging(log_time, log_level, log_dir)
    
    # If redis_only, skip to redisFlow
    if redis_only:
        logger.info("Redis-only mode: skipping harvester and db_loader")
        # Run redis refresh as a subflow
        logger.info("Running redisFlow subflow")
        try:
            redisFlow()
            logger.info("redisFlow completed successfully")
        except Exception as e:
            logger.error(f"redisFlow failed: {e}", exc_info=True)
            raise
        
        logger.info("CDE Pipeline (redis-only) completed successfully")
        return
    
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
    
    parser.add_argument(
        "--incremental",
        help="Run db_loader in incremental mode",
        action="store_true"
    )
    
    parser.add_argument(
        "--redis-only",
        help="Only run the redisFlow subflow (skip harvester and db_loader)",
        action="store_true"
    )
    
    args = parser.parse_args()
    
    try:
        if args.redis_only:
            # Redis-only mode doesn't need config file
            cde_pipeline(redis_only=True)
        elif args.file:
            # Load config and pass incremental flag
            config = load_config(args.file)
            config["incremental"] = args.incremental
            cde_pipeline(config_file=args.file, redis_only=False)
        else:
            logger.error("Config file is required (unless using --redis-only). Use -f or --file to specify harvest_config.yaml")
            sys.exit(1)
    except Exception as e:
        logger.error("Pipeline failed", exc_info=True)
        sys.exit(1)
