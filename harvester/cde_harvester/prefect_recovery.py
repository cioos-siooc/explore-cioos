"""Resume the harvests a worker restart killed.

A redeploy replaces the worker container, and its runs stay RUNNING forever with
nothing left to mark them Crashed. A source only writes to the database once it
has fully harvested, so on a branch that deploys every merge the slow sources
never got that far. Run before the worker starts: every non-final run in the
pool then belongs to a dead worker. A run that fails while its worker lives is
marked Crashed by that worker, so it is never resumed here.
"""

import argparse
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime

from prefect.client.orchestration import get_client
from prefect.client.schemas.filters import (
    FlowRunFilter,
    FlowRunFilterState,
    FlowRunFilterStateType,
    WorkPoolFilter,
    WorkPoolFilterName,
)
from prefect.client.schemas.objects import StateType
from prefect.deployments import run_deployment
from prefect.states import Crashed
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from cde_harvester.core import db as core_db
from cde_harvester.core.config import (
    load_config,
    resolve_harvest_config_file,
    resolve_obis_config,
)
from cde_harvester.prefect_pipeline import (
    HARVEST_FLOW_NAME,
    POOL_NAME,
    _configured_sources,
    deployment_slug,
)

logger = logging.getLogger("cde_harvester.prefect_recovery")

HARVEST_ALL_DEPLOYMENT = "Harvest All Sources/cde-harvest-all"
ORPHAN_STATES = [StateType.RUNNING, StateType.PENDING, StateType.CANCELLING]


@dataclass(frozen=True)
class Orphan:
    id: str
    deployment: str | None  # "<flow name>/<deployment name>"
    parameters: dict = field(default_factory=dict)
    started: datetime | None = None
    parent_flow_run_id: str | None = None


@dataclass(frozen=True)
class Resume:
    deployment: str
    parameters: dict
    idempotency_key: str


def plan_resume(
    orphans: list[Orphan],
    configured: list[str],
    finished_since: Callable[[datetime | None], set[str]],
) -> list[Resume]:
    """Orphaned per-source runs rerun as they were; their siblings under an orphaned
    Harvest All rerun through one new Harvest All, narrowed to the sources with no
    successful harvest since it started. Anything else (Rebuild Database drops the
    schema) is never rerun."""
    orchestrators = [o for o in orphans if o.deployment == HARVEST_ALL_DEPLOYMENT]
    orchestrator_ids = {o.id for o in orchestrators}

    direct = {}
    for o in orphans:
        source = o.parameters.get("source")
        if (
            source
            and (o.deployment or "").startswith(f"{HARVEST_FLOW_NAME}/")
            and o.parent_flow_run_id not in orchestrator_ids
        ):
            direct.setdefault(
                deployment_slug(source),
                Resume(o.deployment, dict(o.parameters), f"resume-{o.id}"),
            )
    plan = list(direct.values())

    remaining, params = {}, {}
    for o in sorted(orchestrators, key=lambda o: o.started or datetime.min.replace(tzinfo=UTC)):
        done = finished_since(o.started) | direct.keys()
        for source in o.parameters.get("sources") or configured:
            if deployment_slug(source) not in done:
                remaining.setdefault(deployment_slug(source), source)
        params = {k: v for k, v in o.parameters.items() if k != "sources"}
    if remaining:
        plan.append(Resume(
            HARVEST_ALL_DEPLOYMENT,
            {**params, "sources": list(remaining.values())},
            "resume-" + "-".join(sorted(o.id for o in orchestrators)),
        ))
    return plan


def _finished_since(since):
    """Unreadable history reruns every source: extra work, never a missed one."""
    if since is None:
        return set()
    try:
        engine = core_db.create_db_engine()
        try:
            with engine.connect() as conn:
                rows = conn.execute(text("""
                    SELECT DISTINCT triggered_source FROM cde.harvest_runs
                    WHERE status = 'ok' AND scope = 'single' AND started_at >= :since
                """), {"since": since}).scalars()
                return {deployment_slug(source) for source in rows}
        finally:
            engine.dispose()
    except (SQLAlchemyError, ValueError) as e:
        logger.warning("No harvest history, resuming every unfinished source: %s", e)
        return set()


def _read_orphans(client):
    runs = client.read_flow_runs(
        flow_run_filter=FlowRunFilter(
            state=FlowRunFilterState(type=FlowRunFilterStateType(any_=ORPHAN_STATES))
        ),
        work_pool_filter=WorkPoolFilter(name=WorkPoolFilterName(any_=[POOL_NAME])),
    )
    deployments = {}
    orphans = []
    for run in runs:
        if run.deployment_id and run.deployment_id not in deployments:
            deployment = client.read_deployment(run.deployment_id)
            flow = client.read_flow(deployment.flow_id)
            deployments[run.deployment_id] = f"{flow.name}/{deployment.name}"
        parent = (
            str(client.read_task_run(run.parent_task_run_id).flow_run_id)
            if run.parent_task_run_id else None
        )
        orphans.append(Orphan(
            id=str(run.id),
            deployment=deployments.get(run.deployment_id),
            parameters=run.parameters or {},
            started=run.start_time or run.expected_start_time,
            parent_flow_run_id=parent,
        ))
    return orphans


def main():
    # force: importing prefect already configured the root logger.
    logging.basicConfig(level=logging.INFO, format="[recovery] %(message)s", force=True)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("-f", "--file", default="harvest_config.yaml", help="harvest_config.yaml")
    args = parser.parse_args()

    config = load_config(resolve_harvest_config_file(args.file))
    obis = resolve_obis_config(config)
    configured = _configured_sources(config.get("erddap_urls") or [], obis.dataset_ids, obis.discovery)

    with get_client(sync_client=True) as client:
        orphans = _read_orphans(client)
        if not orphans:
            logger.info("No runs orphaned by a worker restart")
            return
        for o in orphans:
            client.set_flow_run_state(
                o.id, Crashed(message="Worker restarted (redeploy) while this run was in flight"),
                force=True,
            )
            logger.info("Marked %s (%s) Crashed", o.id, o.deployment)

    for resume in plan_resume(orphans, configured, _finished_since):
        try:
            flow_run = run_deployment(
                resume.deployment, parameters=resume.parameters, timeout=0,
                tags=["resumed"], idempotency_key=resume.idempotency_key,
            )
        except Exception as e:  # one missing deployment must not block the other resumes
            logger.error("Could not resume %s %s: %s", resume.deployment, resume.parameters, e)
            continue
        logger.info("Resumed %s as %s (%s)", resume.deployment, flow_run.id, resume.parameters)


if __name__ == "__main__":
    main()
