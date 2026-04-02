#!/usr/bin/env python3
from prefect import flow, get_run_logger
from cde_harvester.__main__ import main as harvester_main, setup_logging, load_config, load_obis_dataset_ids
from cde_harvester.redisFunctions import redisFlow
from cde_db_loader.__main__ import main as db_loader_main
from dotenv import load_dotenv
import logging
import os
import argparse
import sys
from prefect.client.orchestration import get_client
from prefect.client.schemas.actions import WorkPoolCreate, WorkPoolUpdate
from prefect.exceptions import ObjectNotFound

load_dotenv()

logger = logging.getLogger(__name__)

class PrefectCDEPipeline:
    erddap_urls: str
    cache_requests: bool
    folder: str
    dataset_ids: str
    max_workers: int
    log_time: bool
    log_level: str
    log_dir: str
    incremental: bool
    flush_redis: bool
    obis_dataset_ids: list
    obis_folder: str

    @flow(name="Init CDE Config", log_prints=True)
    def init_config(self, config_file=None):
        """
        Init Prefect for cde_harvester.
        
        Args:
            dotenv_file: Path to .env file for Prefect configuration

        """
        logger = get_run_logger()
        logger.info("INIT CDE Pipeline")

        # Load configuration - config_file is required for deployment
        if not config_file:
            raise ValueError("config_file is required")
        config = load_config(config_file)
        logger.info(f"Using config from {config_file}")

        self.erddap_urls = ",".join(config.get("erddap_urls") or [])
        self.cache_requests = config.get("cache", False)
        self.folder = config.get("folder") or "harvest"
        self.dataset_ids = ",".join(config.get("dataset_ids") or [])
        self.max_workers = config.get("max-workers", 1)
        self.log_time = config.get("log_time", False)
        self.log_level = config.get("log_level", "INFO")
        self.log_dir = os.environ.get("HARVESTER_LOG_DIR") or config.get("log_dir")
        self.incremental = config.get("incremental", False)
        self.flush_redis = config.get("flush_redis", False)
        self.obis_dataset_ids = load_obis_dataset_ids(config)
        self.obis_folder = config.get("obis_folder")

        logger.info("CDE Pipeline initialized with configuration:")
        logger.info(f"{vars(self)}") # does this wrok?

    @flow(name="CDE Pipeline", log_prints=True)
    def cde_pipeline(self):
        """
        Main Prefect flow that runs cde_harvester and cde_db_loader as subflows.
        
        Args:
            config_file: Path to harvest_config.yaml

        """
        logger = get_run_logger()
        logger.info("Starting CDE Pipeline")
        
        # Run harvester as a subflow
        logger.info("Running cde_harvester subflow")
        try:
            harvester_main(
                erddap_urls=self.erddap_urls,
                cache_requests=self.cache_requests,
                folder=self.folder,
                dataset_ids=self.dataset_ids,
                max_workers=self.max_workers,
                obis_dataset_ids=self.obis_dataset_ids,
                obis_folder=self.obis_folder,
            )
            logger.info("cde_harvester completed successfully")
        except Exception as e:
            logger.error(f"cde_harvester failed: {e}", exc_info=True)
            raise
        
        # Run db_loader as a subflow
        logger.info("Running cde_db_loader subflow")
        try:
            db_loader_main(folder=self.folder, incremental=self.incremental)
            logger.info("cde_db_loader completed successfully")
        except Exception as e:
            logger.error(f"cde_db_loader failed: {e}", exc_info=True)

        # Run redis refresh as a subflow
        logger.info("Running redisFlow subflow")
        if self.flush_redis:
            try:
                redisFlow()
                logger.info("redisFlow completed successfully")
            except Exception as e:
                logger.error(f"redisFlow failed: {e}", exc_info=True)
                raise
        
        logger.info("CDE Pipeline completed successfully")
    
    @flow(name="Create Docker Work Pool", log_prints=True)
    def create_docker_work_pool(self, pool_name="docker-pool"):
        """Create or update a Docker work pool for Prefect deployments."""

        # Base job template for Docker
        base_job_template = {
            "job_configuration": {
                "image": "{{ image }}",
                "command": "{{ command }}",
                "env": "{{ env }}",
                "labels": "{{ labels }}",
                "name": "{{ name }}",
                "network_mode": "{{ network_mode }}",
                "networks": "{{ networks }}",
                "volumes": "{{ volumes }}",
                "stream_output": "{{ stream_output }}",
                "auto_remove": "{{ auto_remove }}",
                "image_pull_policy": "{{ image_pull_policy }}",
            },
            "variables": {
                "type": "object",
                "properties": {
                    "image": {
                        "type": "string",
                        "default": "prefecthq/prefect:3-python3.10",
                    },
                    "image_pull_policy": {"type": "string", "default": "Never"},
                    "command": {
                        "type": "string",
                        # CRITICAL: Must use 'uv run' because prefect is in the venv
                        "default": "uv run prefect flow-run execute",
                    },
                    "env": {"type": "object"},
                    "labels": {"type": "object"},
                    "name": {"type": "string"},
                    "network_mode": {"type": "string"},
                    "networks": {"type": "array"},
                    "volumes": {"type": "array"},
                    "stream_output": {"type": "boolean", "default": True},
                    "auto_remove": {"type": "boolean", "default": True},
                },
            },
        }

        # Use sync client for simplicity in this script
        with get_client(sync_client=True) as client:
            pool_exists = True
            try:
                client.read_work_pool(pool_name)
            except ObjectNotFound:
                pool_exists = False

            if pool_exists:
                # Update the job template
                client.update_work_pool(pool_name,work_pool=WorkPoolUpdate(base_job_template=base_job_template))
                logger.info("CDE Workpool Updated")
            else:
                # Create the pool
                client.create_work_pool(
                    work_pool=WorkPoolCreate(
                        name=pool_name,
                        type="docker",
                        base_job_template=base_job_template
                    )
                )
                logger.info("CDE Workpool Created")
    
    @flow(name="Create Deployment", log_prints=True)
    def create_deployment(self):
        # Get host root from environment variable, default to current working directory if running locally
        host_root = os.getenv("HOST_ROOT", os.getcwd())

        self.create_docker_work_pool()

        
        deployment_id = self.deploy(
            name="cde-harvester-deployment",
            work_pool_name="docker-pool",
            image="explore-cioos-harvester:latest",
            cron=os.getenv("HARVESTER_CRON"),
            build=False,  # Don't build, use existing image
            push=False,  # Don't push image
            parameters={
                "config_file": "/app/harvester/harvest_config.yaml",
            },
            job_variables={
                "env": {
                    "PREFECT_API_URL": os.getenv(
                        "PREFECT_API_URL", "http://prefect:4200/api"
                    ),
                    "HARVESTER_LOG_DIR": os.getenv(
                        "HARVESTER_LOG_DIR", "/app/harvester/logs"
                    ),
                    "DB_NAME": os.getenv("DB_NAME", "cde"),
                    "DB_USER": os.getenv("DB_USER", "postgres"),
                    "DB_PASSWORD": os.getenv("DB_PASSWORD", "password"),
                    "DB_HOST": os.getenv("DB_HOST", "db"),
                    "DB_HOST_EXTERNAL": os.getenv("DB_HOST_EXTERNAL", "db"),
                    "REDIS_HOST": os.getenv("REDIS_HOST", "redis"),
                },
                "networks": ["explore-cioos_default"],
                "volumes": [
                    f"{host_root}/harvest_config.yaml:/app/harvester/harvest_config.yaml:ro",
                    f"{host_root}/harvester_cache:/app/harvester/harvester_cache",
                    f"{host_root}/ckan_harvester_cache:/app/harvester/ckan_harvester_cache",
                    f"{host_root}/harvest:/app/harvester/harvest",
                    f"{host_root}/harvester_logs:/app/harvester/logs",
                ],
                "auto_remove": True,
                "stream_output": True,
                "image_pull_policy": "Never",  # Use local image, don't pull
            },
        )
        print("\nTo start a worker, run:")
        print("  docker compose up prefect_worker -d")
        logger.info(f"Deployment created with ID: {deployment_id}")
        return deployment_id

def deploy(pipeline):
    # Create deployment after successful run
    # we should double check that this did deploy
    if pipeline.create_deployment:
        logger.info("CDE Pipeline and Deployment completed successfully")
    else:
        logger.error("CDE Pipeline completed but deployment failed")
        sys.exit(1)

def main():
    parser = argparse.ArgumentParser(description="Run CDE Pipeline with Prefect")
    parser.add_argument("-f", "--file", type=str, default="harvest_config.yaml", help="Path to harvest_config.yaml file")
    parser.add_argument("-d", "--deployment", type=str, default="local", help="Deployment target (local or prod)")
    args = parser.parse_args()
    
    pipeline = PrefectCDEPipeline()

    try:
        if args.file:
            pipeline.init_config(config_file=args.file)
        if args.deployment == "prod":
            deploy(pipeline)
        else:
            logger.error("No config file provided. Use --config-file to specify the path to harvest_config.yaml")
            sys.exit(1)
    except Exception as e:
        logger.error(f"CDE Pipeline failed: {e}", exc_info=True)
        sys.exit(1)
    pipeline.cde_pipeline()

if __name__ == "__main__":
   main()
