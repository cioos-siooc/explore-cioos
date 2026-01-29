#!/usr/bin/env python3
"""
Script to deploy the CDE pipeline to Prefect with a Docker work pool.
This creates the deployment but doesn't run a worker.
"""

import os

from prefect.client.orchestration import get_client
from prefect.client.schemas.actions import WorkPoolCreate, WorkPoolUpdate
from prefect.exceptions import ObjectNotFound

from cde_harvester.run_flow import cde_pipeline


def create_docker_work_pool(pool_name="docker-pool"):
    """
    Create or Update a Docker work pool to ensure correct configuration.
    """

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
        else:
            # Create the pool
            client.create_work_pool(
                work_pool=WorkPoolCreate(
                    name=pool_name,
                    type="docker",
                    base_job_template=base_job_template
                )
            )
def create_deployment():
    """Create a deployment that uses the Docker work pool."""

    # Get host root from environment variable, default to current working directory if running locally
    host_root = os.getenv("HOST_ROOT", os.getcwd())

    # Ensure work pool exists
    create_docker_work_pool()

    deployment_id = cde_pipeline.deploy(
        name="cde-harvester-deployment",
        work_pool_name="docker-pool",
        image="explore-cioos-harvester:latest",
        cron=os.getenv("HARVESTER_CRON"),
        build=False,  # Don't build, use existing image
        push=False,  # Don't push image
        parameters={
            "config_file": "/app/harvester/harvest_config.yaml",
            "redis_only": False,
            "incremental": os.getenv("INCREMENTAL_MODE", "false").lower() == "true",
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


if __name__ == "__main__":
    create_deployment()
