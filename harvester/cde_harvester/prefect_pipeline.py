#!/usr/bin/env python3
import argparse
import logging
import os
import shutil
import sys
import time
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv
from prefect import flow, get_run_logger, task
from prefect.client.orchestration import get_client
from prefect.client.schemas.actions import WorkPoolCreate
from prefect.deployments import run_deployment
from prefect.exceptions import ObjectNotFound

from cde_harvester.__main__ import main as harvester_main
from cde_harvester.core import db as core_db
from cde_harvester.core.config import (
    load_config,
    resolve_harvest_config_file,
    resolve_obis_config,
)
from cde_harvester.core.observability import cleanup_old_logs, run_logger
from cde_harvester.core.schema import (
    check_confirmation,
    ensure_database,
    rebuild_schema,
)
from cde_harvester.loading.loader import main as db_loader_main
from cde_harvester.loading.loader import record_failed_run
from cde_harvester.loading.populate_vernaculars import main as vernaculars_main
from cde_harvester.redisFunctions import clearRedisCache, reloadTopRequests
from cde_harvester.sources import OBIS_ALIASES
from cde_harvester.sources.obis.discovery import ObisDiscoveryConfig
from cde_harvester.sources.obis.geo_filter import ObisGeoFilter

load_dotenv()

logger = logging.getLogger(__name__)


def _run_logger():
    """Some steps run outside a flow context (e.g. init_config on the prod
    deploy path)."""
    return run_logger(logger)

# Upload at most this many bytes (tail) of the log into the markdown artifact;
# Prefect/UI handle large markdown poorly, and the full file stays on disk.
_LOG_ARTIFACT_MAX_BYTES = 200_000


def _publish_log_artifact(log_path):
    if not log_path:
        return
    try:
        from prefect.artifacts import create_markdown_artifact
    except Exception:
        return
    try:
        text = Path(log_path).read_text(errors="replace")
    except OSError as e:
        logger.warning("Could not read log file for artifact: %s", e)
        return

    name = Path(log_path).name
    truncated = len(text) > _LOG_ARTIFACT_MAX_BYTES
    if truncated:
        text = text[-_LOG_ARTIFACT_MAX_BYTES:]

    lines = []
    base = (os.getenv("HARVESTER_LOG_BASE_URL") or "").strip().rstrip("/")
    if base:
        lines.append(f"[Open full log]({base}/harvester_logs/{name})\n")
    lines.append(
        f"_Showing last {_LOG_ARTIFACT_MAX_BYTES // 1000} KB of `{name}`._\n"
        if truncated else f"_`{name}`_\n"
    )
    lines.append("```\n" + text + "\n```")
    try:
        create_markdown_artifact(
            key="harvest-log",
            markdown="\n".join(lines),
            description=f"Harvest log file {name}",
        )
        logger.info("Published harvest log Prefect artifact (%s)", name)
    except Exception as e:
        # Never fail the run for this.
        logger.debug("Could not publish log artifact: %s", e)


POOL_NAME = "cde-process-pool"
# @flow name of cde_pipeline_run; must match harvest-dashboard/app/config.HARVEST_FLOW_NAME.
HARVEST_FLOW_NAME = "Harvest Source"
VERNACULARS_DEPLOYMENT = "Populate Vernaculars/populate-vernaculars-deployment"

TIMESTAMP_FMT = "%Y%m%d_%H%M%S"
KEEP_RUNS_PER_SERVER = 5
# Don't prune folders touched within this window (protects an in-flight run).
PRUNE_GRACE_SECONDS = 6 * 3600


def _timestamp():
    return datetime.now(UTC).strftime(TIMESTAMP_FMT)


def _server_run_folder(base_folder, slug, timestamp):
    return Path(base_folder) / slug / timestamp


@contextmanager
def _harvest_file_log(log_dir, log_level, label):
    """Mirror stdlib logging to {log_dir}/harvest_{ts}_{label}.log (served at /harvester_logs/)."""
    if not log_dir:
        yield None
        return
    Path(log_dir).mkdir(parents=True, exist_ok=True)
    cleanup_old_logs(log_dir, days=30)
    log_path = Path(log_dir) / f"harvest_{_timestamp()}_{label}.log"
    handler = logging.FileHandler(log_path)
    handler.setLevel(logging.getLevelName(str(log_level or "INFO").upper()))
    handler.setFormatter(
        logging.Formatter("%(asctime)s - %(levelname)-8s - %(name)s : %(message)s")
    )
    root = logging.getLogger()
    root.addHandler(handler)
    try:
        yield log_path
    finally:
        root.removeHandler(handler)
        handler.close()


def _prune_server_run_folders(base_folder, keep=KEEP_RUNS_PER_SERVER, protect=()):
    base = Path(base_folder)
    protect = {Path(p).resolve() for p in (protect or ())}
    now = time.time()
    if not base.is_dir():
        return
    for slug_dir in base.iterdir():
        if not slug_dir.is_dir():
            continue
        try:
            runs = sorted(
                (p for p in slug_dir.iterdir() if p.is_dir()),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
        except FileNotFoundError:
            continue
        for path in runs[keep:]:
            if path.resolve() in protect or (now - path.stat().st_mtime) <= PRUNE_GRACE_SECONDS:
                continue  # current run, or too recent to be sure it's idle
            try:
                shutil.rmtree(path)
                logger.info("Pruned old harvest run folder: %s", path)
            except OSError as e:
                logger.warning("Could not prune run folder %s: %s", path, e)


def deployment_slug(source):
    """Stable per-source slug; must match harvest-dashboard/app/config.deployment_slug."""
    if not source or str(source).strip().lower() in OBIS_ALIASES:
        return "obis"
    host = urlparse(source if "://" in source else "https://" + source).hostname or str(source)
    return host.lower().replace(".", "-")


def _trigger_vernaculars():
    """Fire-and-forget: the harvest already loaded, so a failure only logs."""
    logger = _run_logger()
    try:
        flow_run = run_deployment(name=VERNACULARS_DEPLOYMENT, timeout=0)
        logger.info("Triggered %s (flow_run=%s)", VERNACULARS_DEPLOYMENT, flow_run.id)
    except Exception as e:
        logger.warning("Could not trigger %s: %s", VERNACULARS_DEPLOYMENT, e)


def _cron_env(var_name):
    """Cron from env var; unset/empty/whitespace -> None (cron='' breaks Prefect's .deploy)."""
    return (os.getenv(var_name) or "").strip() or None


def _configured_sources(erddap_urls, obis_dataset_ids, obis_discovery):
    """Shared by create_deployment() and cde_harvest_all_run(): registered
    deployments and the fan-out list must never disagree. Under discovery
    `obis_dataset_ids` is empty at config time."""
    sources = [u.strip() for u in (erddap_urls or "").split(",") if u.strip()] \
        if isinstance(erddap_urls, str) else [u.strip() for u in (erddap_urls or []) if u and u.strip()]
    if obis_dataset_ids or (obis_discovery or {}).get("enabled", bool(obis_discovery)):
        sources.append("obis")
    return sources


def _record_failed_run(run_folder, error):
    """Never masks the run's own error."""
    logger = _run_logger()
    try:
        record_failed_run(str(run_folder), f"{type(error).__name__}: {error}")
    except Exception as e:
        logger.error(f"Could not record the failed run: {e}", exc_info=True)


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
    obis_discovery: dict
    obis_geo_filter: dict
    obis_folder: str
    source: str
    triggered_by: str

    def init_config(self, config_file=None):
        logger = _run_logger()
        logger.info("INIT CDE Pipeline")
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
        self.source = None
        self.triggered_by = None
        self.force = False
        # No discovery here: init_config() also runs at deployment
        # registration, which must not depend on api.obis.org.
        obis = resolve_obis_config(config)
        logger.info("OBIS selection mode: %s", obis.mode)
        self.obis_dataset_ids = obis.dataset_ids
        self.obis_discovery = obis.discovery
        self.obis_geo_filter = obis.geo_filter
        self.obis_folder = config.get("obis_folder")

        # Fail a malformed OBIS block at registration, not the first harvest.
        ObisDiscoveryConfig.from_config(self.obis_discovery)
        ObisGeoFilter.from_config(self.obis_geo_filter)

        logger.info("CDE Pipeline initialized with configuration:")
        logger.info(f"{vars(self)}")

    def cde_pipeline(self):
        logger = _run_logger()
        logger.info("Starting CDE Pipeline")

        base_folder = Path(self.folder)
        slug = deployment_slug(self.source) if self.source else "full"
        run_folder = _server_run_folder(base_folder, slug, _timestamp())

        with _harvest_file_log(self.log_dir, self.log_level, slug) as log_path:
            if log_path:
                logger.info("Writing harvest log file: %s (served at /harvester_logs/)", log_path)

            try:
                # The shared OBIS cache MUST live outside the per-run tree, which
                # pruning rmtrees.
                obis_folder = (
                    Path(self.obis_folder)
                    if self.obis_folder
                    else base_folder.resolve().parent / "obis_cache"
                )
                abs_run, abs_obis = run_folder.resolve(), obis_folder.resolve()
                assert abs_obis != abs_run and abs_run not in abs_obis.parents, (
                    f"OBIS cache {obis_folder} must not be inside the per-run folder {run_folder}"
                )
                logger.info("Run output folder: %s (shared OBIS cache: %s)", run_folder, obis_folder)

                # A full reload would wipe other sources; skip_unchanged is only
                # safe for incremental loads (skipped datasets are omitted).
                effective_incremental = self.incremental or bool(self.source)
                if self.source and not self.incremental:
                    logger.warning("Single-source run (source=%s): forcing incremental db-load.", self.source)
                if self.force:
                    logger.info("force=True: re-harvesting every dataset, unchanged or not.")

                logger.info("Running cde_harvester subflow")
                try:
                    load_summary = self._harvest_and_load(
                        run_folder, obis_folder, effective_incremental
                    )
                except Exception as e:
                    _record_failed_run(run_folder, e)
                    raise
                _prune_server_run_folders(base_folder, protect=[run_folder])

                if self.flush_redis and load_summary["changed"]:
                    logger.info("Refreshing redis cache")
                    try:
                        clearRedisCache()
                        reloadTopRequests()
                        logger.info("redis refresh completed successfully")
                    except Exception as e:
                        logger.error(f"redis refresh failed: {e}", exc_info=True)
                        raise
                elif self.flush_redis:
                    logger.info(
                        "Nothing changed in this load (%d changed dataset(s), %d pruned); "
                        "keeping the redis cache warm",
                        load_summary["changed_datasets"],
                        load_summary["pruned"],
                    )

                if self._covers_obis():
                    _trigger_vernaculars()

                logger.info("CDE Pipeline completed successfully")
            finally:
                _publish_log_artifact(log_path)

    def _harvest_and_load(self, run_folder, obis_folder, effective_incremental):
        logger = _run_logger()
        try:
            harvester_main(
                erddap_urls=self.erddap_urls,
                cache_requests=self.cache_requests,
                folder=str(run_folder),
                dataset_ids=self.dataset_ids,
                obis_dataset_ids=self.obis_dataset_ids,
                obis_folder=str(obis_folder),
                obis_geo_filter=self.obis_geo_filter,
                obis_discovery=self.obis_discovery,
                source=self.source,
                triggered_by=self.triggered_by,
                skip_unchanged=effective_incremental and not self.force,
            )
            logger.info("cde_harvester completed successfully")
        except Exception as e:
            logger.error(f"cde_harvester failed: {e}", exc_info=True)
            raise

        logger.info("Running cde_db_loader subflow")
        try:
            load_summary = db_loader_main(
                folder=str(run_folder), incremental=effective_incremental
            )
            logger.info("cde_db_loader completed successfully")
        except Exception as e:
            logger.error(f"cde_db_loader failed: {e}", exc_info=True)
            raise
        return load_summary

    def _covers_obis(self):
        if self.source:
            return deployment_slug(self.source) == "obis"
        return "obis" in _configured_sources(
            self.erddap_urls, self.obis_dataset_ids, self.obis_discovery
        )

    def create_process_work_pool(self, pool_name="cde-process-pool"):
        base_job_template = {
            "job_configuration": {
                "command": "{{ command }}",
                "env": "{{ env }}",
                "labels": "{{ labels }}",
                "name": "{{ name }}",
                "stream_output": "{{ stream_output }}",
                "working_dir": "{{ working_dir }}",
            },
            "variables": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "default": "uv run prefect flow-run execute",
                    },
                    "env": {"type": "object"},
                    "labels": {"type": "object"},
                    "name": {"type": "string"},
                    "stream_output": {"type": "boolean", "default": True},
                    "working_dir": {"type": "string"},
                },
            },
        }

        with get_client(sync_client=True) as client:
            try:
                client.read_work_pool(pool_name)
                logger.info("CDE process work pool already exists: %s", pool_name)
                return
            except ObjectNotFound:
                pass
            try:
                client.create_work_pool(
                    work_pool=WorkPoolCreate(
                        name=pool_name,
                        type="process",
                        base_job_template=base_job_template,
                    )
                )
                logger.info("CDE process work pool created: %s", pool_name)
            except Exception as e:
                if "already exists" in str(e).lower():
                    logger.info("CDE process work pool created concurrently: %s", pool_name)
                else:
                    raise

    def create_deployment(self):
        self.create_process_work_pool(POOL_NAME)

        source_dir = str(Path(__file__).resolve().parent.parent)

        job_vars = {
            "env": {
                "PREFECT_LOGGING_EXTRA_LOGGERS": "populate_vernaculars,cde_harvester",
                "CDE_ALLOW_FULL_RELOAD": os.getenv("CDE_ALLOW_FULL_RELOAD", ""),
            },
        }

        # A plain @flow function: Prefect can't fill `self` for a bound method.
        harvest_id = flow.from_source(
            source=source_dir,
            entrypoint="cde_harvester/prefect_pipeline.py:cde_pipeline_run",
        ).deploy(
            name="cde-harvester-deployment",
            work_pool_name=POOL_NAME,
            cron=None,
            parameters={"config_file": "/app/harvester/harvest_config.yaml"},
            job_variables=job_vars,
        )

        vernaculars_id = flow.from_source(
            source=source_dir,
            entrypoint="cde_harvester/prefect_pipeline.py:populate_vernaculars_run",
        ).deploy(
            name="populate-vernaculars-deployment",
            work_pool_name=POOL_NAME,
            cron=_cron_env("VERNACULARS_CRON"),
            job_variables=job_vars,
        )

        per_source = _configured_sources(
            self.erddap_urls, self.obis_dataset_ids, self.obis_discovery
        )
        source_deployment_names = []
        for src in per_source:
            dep_name = f"cde-harvester-{deployment_slug(src)}"
            flow.from_source(
                source=source_dir,
                entrypoint="cde_harvester/prefect_pipeline.py:cde_pipeline_run",
            ).deploy(
                name=dep_name,
                work_pool_name=POOL_NAME,
                cron=None,
                parameters={
                    "config_file": "/app/harvester/harvest_config.yaml",
                    "source": src,
                },
                job_variables=job_vars,
            )
            source_deployment_names.append(dep_name)
            logger.info("Per-source deployment registered: %s (source=%s)", dep_name, src)

        rebuild_id = flow.from_source(
            source=source_dir,
            entrypoint="cde_harvester/prefect_pipeline.py:cde_rebuild_database_run",
        ).deploy(
            name="cde-rebuild-database",
            work_pool_name=POOL_NAME,
            cron=None,
            job_variables=job_vars,
        )

        # Registered after the per-source deployments it triggers.
        orchestrator_id = flow.from_source(
            source=source_dir,
            entrypoint="cde_harvester/prefect_pipeline.py:cde_harvest_all_run",
        ).deploy(
            name="cde-harvest-all",
            work_pool_name=POOL_NAME,
            cron=_cron_env("HARVESTER_CRON"),
            parameters={"config_file": "/app/harvester/harvest_config.yaml"},
            job_variables=job_vars,
        )

        print("\nTo start a worker, run:")
        print(f"  uv run prefect worker start --pool {POOL_NAME} --type process")
        logger.info(
            "Deployments created: cde-harvester=%s cde-harvest-all=%s "
            "populate-vernaculars=%s rebuild-database=%s per-source=%s",
            harvest_id, orchestrator_id, vernaculars_id, rebuild_id, source_deployment_names,
        )
        return harvest_id


def _pipeline_run_name():
    """Only the flow_run_name: the flow NAME stays 'Harvest Source' for the
    dashboard deployment lookup."""
    from prefect.runtime import flow_run

    source = (flow_run.parameters or {}).get("source")
    if not source:
        return "harvest-full"
    slug = deployment_slug(source)
    if slug == "obis":
        return "harvest-obis"
    return f"harvest-erddap-{slug}"


@flow(name="Harvest Source", flow_run_name=_pipeline_run_name, log_prints=True)
def cde_pipeline_run(
    config_file: str = "/app/harvester/harvest_config.yaml",
    source: str | None = None,
    triggered_by: str | None = None,
    force: bool = False,
):
    """Deployable entry point. `source` (None = full) narrows to one ERDDAP url or 'obis';
    `triggered_by` is recorded on the audit row; `force` re-harvests datasets whose
    Croissant hash is unchanged. Single-source runs force incremental db-load."""
    config_file = resolve_harvest_config_file(config_file)
    pipeline = PrefectCDEPipeline()
    pipeline.init_config(config_file=config_file)
    pipeline.source = source
    pipeline.triggered_by = triggered_by
    pipeline.force = force
    pipeline.cde_pipeline()


_POLL_INTERVAL_S = 5
_MAX_CONSECUTIVE_POLL_FAILURES = 60  # ~5 min of continuous API unavailability


@task(name="trigger-source-harvest")
def _trigger_source_harvest(source: str, triggered_by: str | None = None, force: bool = False):
    """Submit the per-source deployment for `source` and wait for it to finish; return a
    status dict (never raises).

    Submit and wait are separate: a transient API error while polling a submitted
    child is not a harvest failure, so it is tolerated. No @task(retries=...): a
    retry would spawn a duplicate child harvest."""
    logger = get_run_logger()
    deployment_name = f"{HARVEST_FLOW_NAME}/cde-harvester-{deployment_slug(source)}"
    params = {"source": source}
    if triggered_by:
        params["triggered_by"] = triggered_by
    if force:
        params["force"] = True

    try:
        flow_run = run_deployment(name=deployment_name, parameters=params, timeout=0)
    except Exception as e:  # deployment missing / API error — report, don't abort the batch
        return {"source": source, "deployment": deployment_name,
                "flow_run_id": None, "state": "TRIGGER_ERROR", "error": str(e)}

    flow_run_id = flow_run.id
    flow_run_name = flow_run.name
    base = {"source": source, "deployment": deployment_name,
            "flow_run_id": str(flow_run_id), "flow_run_name": flow_run_name}

    consecutive_failures = 0
    last_error = None
    while True:
        time.sleep(_POLL_INTERVAL_S)
        try:
            with get_client(sync_client=True) as client:
                state = client.read_flow_run(flow_run_id).state
            consecutive_failures = 0
        except Exception as e:
            consecutive_failures += 1
            last_error = str(e)
            logger.warning(
                "Transient error polling %s (%s), attempt %d/%d: %s",
                source, flow_run_id, consecutive_failures,
                _MAX_CONSECUTIVE_POLL_FAILURES, last_error,
            )
            if consecutive_failures >= _MAX_CONSECUTIVE_POLL_FAILURES:
                # Distinct from TRIGGER_ERROR: the child may well have completed.
                return {**base, "state": "POLL_ERROR", "completed": False,
                        "error": f"gave up polling after {consecutive_failures} "
                                 f"consecutive failures: {last_error}"}
            continue

        if state and state.is_final():
            return {**base,
                    "state": state.name,
                    "completed": state.is_completed(),
                    "error": None if state.is_completed() else f"final state {state.name}"}


@flow(name="Harvest All Sources", log_prints=True)
def cde_harvest_all_run(
    config_file: str = "/app/harvester/harvest_config.yaml",
    triggered_by: str | None = None,
    force: bool = False,
):
    """Scheduled fan-out: trigger one independent per-source harvest job per configured source,
    wait for all, and fail red if any did not complete (a failure doesn't cancel the others)."""
    logger = _run_logger()

    config_file = resolve_harvest_config_file(config_file)
    config = load_config(config_file)

    obis = resolve_obis_config(config)
    sources = _configured_sources(
        config.get("erddap_urls") or [], obis.dataset_ids, obis.discovery
    )
    if not sources:
        raise ValueError(
            "No sources configured to harvest (erddap_urls / obis_discovery / "
            "obis_dataset_ids / obis_datasets_file)"
        )

    logger.info("Fanning out %d per-source harvest job(s): %s", len(sources), sources)
    futures = [_trigger_source_harvest.submit(src, triggered_by, force) for src in sources]
    results = [f.result() for f in futures]

    for r in results:
        logger.info("Source %s -> %s [%s] (flow_run=%s)",
                    r["source"], r["deployment"], r["state"], r.get("flow_run_id"))
    failed = [r for r in results if not r.get("completed")]
    if failed:
        raise RuntimeError(
            f"{len(failed)}/{len(sources)} per-source harvest job(s) did not complete: "
            + ", ".join(
                f"{r['source']}={r['state']}"
                + (f" ({r['error']})" if r.get("error") else "")
                for r in failed
            )
        )
    logger.info("All %d per-source harvest job(s) completed", len(sources))


@flow(name="Populate Vernaculars", log_prints=True)
def populate_vernaculars_run(
    top: int = 0,
    limit: int = 0,
    workers: int = 8,
    batch_size: int = 50,
    refresh_status: str = "",
):
    """Populate cde.scientific_name_vernaculars from WoRMS (idempotent + resumable).

    top: N most-common species (0 = all); limit: row cap (0 = none); refresh_status:
    re-fetch rows whose prior status matches, e.g. "error,not_found" ("" = only new).
    """
    # PREFECT_LOGGING_EXTRA_LOGGERS attaches a handler but doesn't set the level,
    # so force INFO or the script's progress lines get filtered out.
    for name in ("populate_vernaculars", "cde_harvester"):
        logging.getLogger(name).setLevel(logging.INFO)

    # populate_vernaculars uses argparse; monkey-patch sys.argv instead of refactoring it.
    argv = ["populate_vernaculars"]
    if top > 0:
        argv += ["--top", str(top)]
    if limit > 0:
        argv += ["--limit", str(limit)]
    argv += ["--workers", str(workers), "--batch-size", str(batch_size)]
    if refresh_status:
        argv += ["--refresh-status", refresh_status]

    print(f"populate_vernaculars argv: {argv}")
    saved_argv = sys.argv
    try:
        sys.argv = argv
        vernaculars_main()
    finally:
        sys.argv = saved_argv
    print("vernaculars_main() returned")


@flow(name="Rebuild Database", log_prints=True)
def cde_rebuild_database_run(
    confirm: str = "",
    run_harvest: bool = True,
    flush_redis: bool = True,
    triggered_by: str | None = None,
):
    """DESTRUCTIVE: drop the cde schema, recreate it from database/*.sql, re-harvest.

    For when a deploy changes the table layout: Postgres applies 1_schema.sql only on a
    fresh volume and db_migrate re-applies only the [3-9] function files.

    ALL HARVESTED DATA IS LOST. `confirm` must be the database name (DB_NAME).

    run_harvest: trigger "Harvest All Sources" afterwards to repopulate.
    """
    logger = _run_logger()

    expected = check_confirmation(
        confirm, db_name=core_db.db_name(), host=core_db.db_host()
    )

    logger.warning(
        "Rebuilding schema '%s' on %s — dropping all harvested data%s",
        expected, core_db.db_host(), f" (triggered by {triggered_by})" if triggered_by else "",
    )

    # A volume initialised before DB_NAME was set has only `postgres`; CREATE
    # DATABASE can't run inside the rebuild's transaction.
    maint = core_db.maintenance_engine()
    try:
        if ensure_database(maint, expected):
            logger.warning(
                "Database %r did not exist on %s — created it. This deployment's Postgres "
                "volume was initialised before DB_NAME was set.", expected, core_db.db_host(),
            )
    finally:
        maint.dispose()

    engine = core_db.create_db_engine()
    try:
        report = rebuild_schema(engine)
    finally:
        engine.dispose()

    logger.info(
        "Schema rebuilt: %s + %s -> %d tables",
        report["init_file"], ", ".join(report["function_files"]), report["tables_created"],
    )

    if flush_redis:
        try:
            clearRedisCache()
        except Exception as e:  # cache is best-effort — never fail the rebuild on it
            logger.warning("Could not flush the redis cache (%s); tiles may serve stale data", e)

    if not run_harvest:
        logger.warning(
            "run_harvest=False — the schema is empty. Trigger a harvest before expecting "
            "the app to show data."
        )
        return report

    # Don't fail the flow here: a red run after a successful drop invites
    # re-running a destructive operation that already did its job.
    logger.info("Triggering 'Harvest All Sources' to repopulate the empty schema")
    try:
        run_deployment(
            name="Harvest All Sources/cde-harvest-all",
            parameters={"triggered_by": triggered_by or "rebuild-database"},
            timeout=0,
        )
        report["harvest_triggered"] = True
    except Exception as e:
        report["harvest_triggered"] = False
        report["harvest_trigger_error"] = str(e)
        logger.error(
            "Schema was rebuilt, but triggering 'Harvest All Sources' failed (%s). The "
            "database is EMPTY until a harvest runs — trigger it manually. Do NOT re-run "
            "the rebuild; it already completed.",
            e,
        )
    return report


def deploy(pipeline):
    try:
        pipeline.create_deployment()
        logger.info("CDE Pipeline and Deployment completed successfully")
    except Exception as e:
        logger.error("CDE Pipeline completed but deployment failed: %s", e)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Run CDE Pipeline with Prefect")
    parser.add_argument(
        "-f",
        "--file",
        type=str,
        default="harvest_config.yaml",
        help="Path to harvest_config.yaml file",
    )
    parser.add_argument("-d", "--deployment", type=str, default="local", help="Deployment target (local or prod)")
    args = parser.parse_args()

    if not args.file:
        logger.error("No config file provided. Use -f to specify harvest_config.yaml")
        sys.exit(1)
    # Resolve HARVEST_CONFIG_B64 at registration too, or the per-source
    # deployments diverge from what the orchestrator resolves at run time.
    config_file = resolve_harvest_config_file(args.file)
    try:
        if args.deployment == "prod":
            pipeline = PrefectCDEPipeline()
            pipeline.init_config(config_file=config_file)
            deploy(pipeline)
        else:
            # The harvest .submit() tasks need a flow's task runner.
            cde_pipeline_run(config_file=config_file)
    except Exception as e:
        logger.error(f"CDE Pipeline failed: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
