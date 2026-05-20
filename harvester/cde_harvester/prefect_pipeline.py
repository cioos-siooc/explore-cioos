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
            config_file: Path to harvest_config.yaml

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
        self.log_time = config.get("log_time", False)
        self.log_level = config.get("log_level", "INFO")
        self.log_dir = os.environ.get("HARVESTER_LOG_DIR") or config.get("log_dir")
        self.incremental = config.get("incremental", False)
        self.flush_redis = config.get("flush_redis", False)
        self.obis_dataset_ids = load_obis_dataset_ids(
            dataset_ids=config.get("obis_dataset_ids"),
            datasets_file=config.get("obis_datasets_file"),
        )
        self.obis_folder = config.get("obis_folder")

        logger.info("CDE Pipeline initialized with configuration:")
        logger.info(f"{vars(self)}")

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
            raise

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

        # Coolify-friendly knobs. Defaults preserve the original production
        # (bare docker-compose) behaviour; Coolify deployments override via
        # COOLIFY_RESOURCE_UUID (auto-injected) so the spawned flow-run
        # containers join the project-scoped network and attach the
        # project-scoped named volumes.
        job_image = os.getenv("HARVESTER_IMAGE", "explore-cioos-harvester:latest")
        coolify_uuid = os.getenv("COOLIFY_RESOURCE_UUID", "").strip()
        if coolify_uuid:
            # Coolify deployment
            job_network = coolify_uuid
            volume_prefix = coolify_uuid + "_"
        else:
            # Bare docker-compose / production
            job_network = os.getenv("PREFECT_DOCKER_NETWORK", "explore-cioos_default")
            volume_prefix = os.getenv("PREFECT_VOLUME_PREFIX", "")

        if volume_prefix:
            job_volumes = [
                f"{volume_prefix}harvester-cache:/app/harvester/harvester_cache",
                f"{volume_prefix}harvest-data:/app/harvester/harvest",
                f"{volume_prefix}harvester-logs:/app/harvester/logs",
                f"{volume_prefix}obis-cache:/app/harvester/obis_cache",
                # Read-only override directory. cde_pipeline_run() picks files
                # out of this if present, falling back to baked-in defaults.
                f"{volume_prefix}cde-overrides:/app/harvester/overrides:ro",
            ]
        else:
            job_volumes = [
                f"{host_root}/harvest_config.yaml:/app/harvester/harvest_config.yaml:ro",
                f"{host_root}/harvester_cache:/app/harvester/harvester_cache",
                f"{host_root}/ckan_harvester_cache:/app/harvester/ckan_harvester_cache",
                f"{host_root}/harvest:/app/harvester/harvest",
                f"{host_root}/harvester_logs:/app/harvester/logs",
            ]

        self.create_docker_work_pool()

        # Deploy the top-level wrapper flow (not the bound method) — Prefect's
        # deployment runner can't fill `self` for class-method flows, so we
        # use cde_pipeline_run which is a regular @flow function.
        deployment_id = cde_pipeline_run.deploy(
            name="cde-harvester-deployment",
            work_pool_name="docker-pool",
            image=job_image,
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
                    # Operator-supplied overrides via Coolify env vars. The
                    # spawned flow-run container reads these in cde_pipeline_run()
                    # and writes them to /tmp/ before loading config. Empty
                    # values are harmless (treated as "not set").
                    "HARVEST_CONFIG_YAML": os.getenv("HARVEST_CONFIG_YAML", ""),
                    "OBIS_DATASETS_JSON": os.getenv("OBIS_DATASETS_JSON", ""),
                },
                "networks": [job_network],
                "volumes": job_volumes,
                "auto_remove": True,
                "stream_output": True,
                "image_pull_policy": "Never",  # Use local image, don't pull
            },
        )
        print("\nTo start a worker, run:")
        print("  docker compose up prefect_worker -d")
        logger.info(f"Deployment created with ID: {deployment_id}")
        return deployment_id

@flow(name="CDE Pipeline Run", log_prints=True)
def cde_pipeline_run(config_file: str = "/app/harvester/harvest_config.yaml"):
    """Deployable entry point for the harvest pipeline.

    Prefect deployments invoke whatever flow is registered as a regular
    function call. PrefectCDEPipeline.cde_pipeline is a method (its signature
    is `(self)`), which Prefect's deployment runner can't fill — it raises
    SignatureMismatchError. This top-level wrapper instantiates the pipeline
    and runs init_config + cde_pipeline so the worker has something it can
    actually execute.

    Override mechanism (precedence high -> low):

    1. HARVEST_CONFIG_YAML env var. Pure UI workflow: paste YAML into Coolify's
       env var editor, redeploy. Most natural for cloud-style ops since
       Coolify's Persistent Storage UI is read-only for compose-based
       resources. If your YAML references /tmp/Obis_Datasets.json for
       obis_datasets_file, also set OBIS_DATASETS_JSON to override the OBIS
       list — written to /tmp/Obis_Datasets.json at startup.

    2. /app/harvester/overrides/harvest_config.yaml. Bind-mounted from the
       cde_overrides named volume; editable via Coolify Terminal (`nano`)
       on the prefect_worker container. Survives redeploys.

    3. Baked-in default at /app/harvester/harvest_config.yaml. Used if neither
       override is provided.
    """
    env_config = os.getenv("HARVEST_CONFIG_YAML", "").strip()
    override_path = "/app/harvester/overrides/harvest_config.yaml"
    if env_config:
        env_config_path = "/tmp/harvest_config_from_env.yaml"
        with open(env_config_path, "w") as f:
            f.write(env_config)
        config_file = env_config_path
        logger.info(
            f"Using HARVEST_CONFIG_YAML env var ({len(env_config)} bytes -> {env_config_path})"
        )
    elif os.path.exists(override_path):
        config_file = override_path
        logger.info(f"Using override harvest config: {override_path}")
    else:
        logger.info(f"Using baked-in harvest config: {config_file}")

    # Optional OBIS override via env var. The harvest config's
    # obis_datasets_file should reference /tmp/Obis_Datasets.json to pick it up.
    env_obis = os.getenv("OBIS_DATASETS_JSON", "").strip()
    if env_obis:
        with open("/tmp/Obis_Datasets.json", "w") as f:
            f.write(env_obis)
        logger.info(
            f"Wrote OBIS_DATASETS_JSON env var ({len(env_obis)} bytes -> /tmp/Obis_Datasets.json)"
        )

    pipeline = PrefectCDEPipeline()
    pipeline.init_config(config_file=config_file)
    pipeline.cde_pipeline()


def deploy(pipeline):
    # Create deployment after successful run
    try:
        pipeline.create_deployment()
        logger.info("CDE Pipeline and Deployment completed successfully")
    except Exception as e:
        logger.error("CDE Pipeline completed but deployment failed: %s", e)
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
        else:
            logger.error("No config file provided. Use --config-file to specify the path to harvest_config.yaml")
            sys.exit(1)
        if args.deployment == "prod":
            # In 'prod' mode this process only REGISTERS the Prefect deployment
            # and exits — the worker is responsible for actually running the
            # pipeline on schedule / on demand. Running cde_pipeline() here
            # would (a) duplicate work the worker will do, and (b) make
            # registration sensitive to transient harvest failures, which
            # repeatedly kills Coolify deploys.
            deploy(pipeline)
        else:
            pipeline.cde_pipeline()
    except Exception as e:
        logger.error(f"CDE Pipeline failed: {e}", exc_info=True)
        sys.exit(1)

if __name__ == "__main__":
    main()
