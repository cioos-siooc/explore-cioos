"""Thin Prefect REST client — just enough to create a per-source harvest run.

Uses httpx (two small JSON calls) rather than the full prefect SDK to keep the
dashboard image small and decoupled from the harvester's Prefect version pin.
"""

from urllib.parse import quote

import httpx

from . import config


class PrefectError(Exception):
    """Raised when the Prefect API can't be reached or refuses the request.

    The route catches this and renders a friendly partial — a failed trigger
    must never 500 the page.
    """


def trigger_source_harvest(source: str, triggered_by: str | None = None,
                           timeout: float = 10.0) -> dict:
    """Create a flow run for the per-source deployment matching ``source``.

    ``source`` is an ERDDAP url or 'obis'. Returns the created flow run's id/name
    so the caller can deep-link to the Prefect UI. Raises PrefectError on any
    failure.
    """
    deployment_name = f"cde-harvester-{config.deployment_slug(source)}"
    base = config.PREFECT_API_URL
    flow_seg = quote(config.HARVEST_FLOW_NAME, safe="")
    dep_seg = quote(deployment_name, safe="")
    params = {"source": source}
    if triggered_by:
        params["triggered_by"] = triggered_by

    try:
        with httpx.Client(timeout=timeout) as client:
            # 1) Resolve the deployment id by "<flow name>/<deployment name>".
            dep = client.get(f"{base}/deployments/name/{flow_seg}/{dep_seg}")
            if dep.status_code == 404:
                raise PrefectError(
                    f"No Prefect deployment '{deployment_name}' for source "
                    f"{source!r}. Has create_deployment run since this source "
                    "was added to harvest_config.yaml?"
                )
            dep.raise_for_status()
            deployment_id = dep.json()["id"]

            # 2) Create the flow run. Run-time parameters merge over the
            #    deployment's defaults, so passing source+triggered_by is enough.
            resp = client.post(
                f"{base}/deployments/{deployment_id}/create_flow_run",
                json={"parameters": params},
            )
            resp.raise_for_status()
            flow_run = resp.json()
    except httpx.HTTPStatusError as e:
        raise PrefectError(
            f"Prefect API error {e.response.status_code}: {e.response.text[:200]}"
        ) from e
    except httpx.HTTPError as e:
        raise PrefectError(f"Could not reach Prefect API at {base}: {e}") from e
    except (KeyError, ValueError) as e:
        raise PrefectError(f"Unexpected Prefect API response: {e}") from e

    return {
        "flow_run_id": flow_run.get("id"),
        "flow_run_name": flow_run.get("name"),
        "deployment_name": deployment_name,
        "source": source,
    }
