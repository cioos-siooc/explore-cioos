"""Dashboard configuration + Prefect wiring.

Read once at import (mirrors db.py's env pattern). All Prefect/trigger settings
live here so the rest of the app stays Postgres-only by default.

The dashboard is fronted by Cloudflare Access (CIOOS accounts) — that is the
auth gate. HARVEST_TRIGGER_ENABLED is just a kill-switch so the trigger button
can be turned off per-environment; triggering runs are attributed to the
Cloudflare-Access user (Cf-Access-Authenticated-User-Email header).
"""

import os
from urllib.parse import urlparse

from dotenv import load_dotenv

load_dotenv()

# Internal Prefect REST API (same value the harvester/worker use); reachable on
# the shared docker network. Used server-side to create flow runs.
PREFECT_API_URL = os.environ.get("PREFECT_API_URL", "http://prefect:4200/api").rstrip("/")

# External Prefect UI base URL that a USER'S BROWSER can reach — used to build
# "View in Prefect" deep-links. Configurable because it changes per stack; the
# link only renders when this is set and a flow_run_id was captured.
PREFECT_UI_URL = os.environ.get(
    "PREFECT_UI_URL", "https://prefect-obis.cool.beluga.cioos.ca"
).rstrip("/")

# The registered @flow name of the deployable harvest pipeline
# (prefect_pipeline.cde_pipeline_run). Per-source deployments live under it.
HARVEST_FLOW_NAME = os.environ.get("HARVEST_FLOW_NAME", "CDE Pipeline Run")

# Kill-switch. When false (default) the trigger button is hidden and the POST
# endpoint returns 403.
HARVEST_TRIGGER_ENABLED = os.environ.get("HARVEST_TRIGGER_ENABLED", "false").lower() in (
    "1", "true", "yes",
)

# OBIS is one monolithic source recorded under this sentinel erddap_url; aliases
# the harvester accepts. Kept in sync with cde_harvester deployment_slug.
OBIS_SENTINEL_URL = "https://obis.org"
_OBIS_ALIASES = {"obis", "https://obis.org", "http://obis.org", "obis.org"}


def deployment_slug(source: str) -> str:
    """Slug for a per-source deployment name. MUST match
    cde_harvester.prefect_pipeline.deployment_slug so a dashboard-triggered run
    lands on the same per-source deployment as one triggered from the Prefect UI.
    """
    if not source or str(source).strip().lower() in _OBIS_ALIASES:
        return "obis"
    host = urlparse(source if "://" in source else "https://" + source).hostname or str(source)
    return host.lower().replace(".", "-")


def source_for(erddap_url: str) -> str:
    """Map a dashboard server's erddap_url to the `source` value the harvester
    expects: 'obis' for the OBIS sentinel, else the erddap_url unchanged."""
    if not erddap_url or str(erddap_url).strip().lower() in _OBIS_ALIASES:
        return "obis"
    return erddap_url


def prefect_run_url(flow_run_id) -> str:
    """External Prefect UI URL for a flow run, or '' when not linkable."""
    if not flow_run_id or not PREFECT_UI_URL:
        return ""
    return f"{PREFECT_UI_URL}/runs/flow-run/{flow_run_id}"
