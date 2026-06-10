#!/usr/bin/env python3
import argparse
import logging
import os
import shutil
import sys
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv
from prefect import flow, get_run_logger, task
from prefect.client.orchestration import get_client
from prefect.client.schemas.actions import WorkPoolCreate
from prefect.deployments import run_deployment
from prefect.exceptions import ObjectNotFound

from cde_harvester.__main__ import (
    cleanup_old_logs,
    load_config,
    load_obis_dataset_ids,
    main as harvester_main,
)
from cde_harvester.redisFunctions import clearRedisCache, reloadTopRequests
from cde_db_loader.__main__ import main as db_loader_main

load_dotenv()

logger = logging.getLogger(__name__)


def _run_logger():
    """Prefect run logger when inside a run, else the module logger.

    The pipeline steps below are plain methods now (not @flow), so some run
    outside a flow context (e.g. init_config on the prod deploy path)."""
    try:
        return get_run_logger()
    except Exception:
        return logger

# Upload at most this many bytes (tail) of the log into the markdown artifact;
# Prefect/UI handle large markdown poorly, and the full file stays on disk.
_LOG_ARTIFACT_MAX_BYTES = 200_000


def _publish_log_artifact(log_path):
    """Upload the harvest log file as a Prefect markdown artifact (keyed
    'harvest-log') so it's viewable from the run's Artifacts tab. If
    HARVESTER_LOG_BASE_URL is set, also embed a clickable link to the served
    file (served at {base}/harvester_logs/{name}). No-op outside a run context."""
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
        # Outside a flow/task run context, or API hiccup — never fail the run for this.
        logger.debug("Could not publish log artifact: %s", e)


# OBIS aliases the dashboard / a deployment may pass; kept in sync with
# cde_harvester.__main__._OBIS_ALIASES.
_OBIS_ALIASES = {"obis", "https://obis.org", "http://obis.org", "obis.org"}

# Process work pool the worker(s) poll; flows run in-process (no spawned containers).
POOL_NAME = "cde-process-pool"
# @flow name of cde_pipeline_run; must match harvest-dashboard/app/config.HARVEST_FLOW_NAME.
HARVEST_FLOW_NAME = "Harvest Source"

TIMESTAMP_FMT = "%Y%m%d_%H%M%S"
KEEP_RUNS_PER_SERVER = 5
# Don't prune folders touched within this window (protects an in-flight run).
PRUNE_GRACE_SECONDS = 6 * 3600


def _timestamp():
    return datetime.now().strftime(TIMESTAMP_FMT)


def _server_run_folder(base_folder, slug, timestamp):
    """Per-server, per-run output folder: {base}/{slug}/{timestamp}."""
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
    """Keep the newest `keep` timestamped runs per server under base_folder; reclaim older ones."""
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
    if not source or str(source).strip().lower() in _OBIS_ALIASES:
        return "obis"
    host = urlparse(source if "://" in source else "https://" + source).hostname or str(source)
    return host.lower().replace(".", "-")


def _cron_env(var_name):
    """Cron from env var; unset/empty/whitespace -> None (cron='' breaks Prefect's .deploy)."""
    return (os.getenv(var_name) or "").strip() or None


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
    source: str
    triggered_by: str

    def init_config(self, config_file=None):
        """Load harvest_config.yaml into this pipeline instance."""
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
        # Defaults; cde_pipeline_run() overrides these for a single-source run.
        self.source = None
        self.triggered_by = None
        self.obis_dataset_ids = load_obis_dataset_ids(
            dataset_ids=config.get("obis_dataset_ids"),
            datasets_file=config.get("obis_datasets_file"),
        )
        self.obis_folder = config.get("obis_folder")

        logger.info("CDE Pipeline initialized with configuration:")
        logger.info(f"{vars(self)}")

    def cde_pipeline(self):
        """Harvest one source (or all), load to DB, optionally refresh redis."""
        logger = _run_logger()
        logger.info("Starting CDE Pipeline")

        # Per-server, per-run folder {base}/{slug}/{ts} so concurrent runs don't clobber.
        base_folder = Path(self.folder)
        slug = deployment_slug(self.source) if self.source else "full"
        run_folder = _server_run_folder(base_folder, slug, _timestamp())

        with _harvest_file_log(self.log_dir, self.log_level, slug) as log_path:
            if log_path:
                logger.info("Writing harvest log file: %s (served at /harvester_logs/)", log_path)

            # try/finally so the log file is uploaded as a Prefect artifact on
            # both success AND failure (a failed run is exactly when the log
            # matters); the per-dataset status table is published separately
            # from the harvester (see __main__._publish_status_artifact).
            try:
                # OBIS cache is shared across runs and MUST live outside the per-run tree
                # (pruning rmtrees per-server run dirs); keep it a sibling of base_folder.
                obis_folder = Path(self.obis_folder) if self.obis_folder else base_folder.resolve().parent / "obis_cache"
                abs_run, abs_obis = run_folder.resolve(), obis_folder.resolve()
                assert abs_obis != abs_run and abs_run not in abs_obis.parents, (
                    f"OBIS cache {obis_folder} must not be inside the per-run folder {run_folder}"
                )
                logger.info("Run output folder: %s (shared OBIS cache: %s)", run_folder, obis_folder)

                # Force incremental for single-source runs (full-reload would wipe
                # other sources). Computed here so skip_unchanged is only set when
                # the load is incremental — a skipped dataset is omitted from the CSV.
                effective_incremental = self.incremental or bool(self.source)
                if self.source and not self.incremental:
                    logger.warning("Single-source run (source=%s): forcing incremental db-load.", self.source)

                logger.info("Running cde_harvester subflow")
                try:
                    harvester_main(
                        erddap_urls=self.erddap_urls,
                        cache_requests=self.cache_requests,
                        folder=str(run_folder),
                        dataset_ids=self.dataset_ids,
                        obis_dataset_ids=self.obis_dataset_ids,
                        obis_folder=str(obis_folder),
                        source=self.source,
                        triggered_by=self.triggered_by,
                        skip_unchanged=effective_incremental,
                    )
                    logger.info("cde_harvester completed successfully")
                except Exception as e:
                    logger.error(f"cde_harvester failed: {e}", exc_info=True)
                    raise

                logger.info("Running cde_db_loader subflow")
                try:
                    db_loader_main(folder=str(run_folder), incremental=effective_incremental)
                    logger.info("cde_db_loader completed successfully")
                    # Prune only after a successful load so failed runs' CSVs survive.
                    _prune_server_run_folders(base_folder, protect=[run_folder])
                except Exception as e:
                    logger.error(f"cde_db_loader failed: {e}", exc_info=True)
                    raise

                if self.flush_redis:
                    logger.info("Refreshing redis cache")
                    try:
                        clearRedisCache()
                        reloadTopRequests()
                        logger.info("redis refresh completed successfully")
                    except Exception as e:
                        logger.error(f"redis refresh failed: {e}", exc_info=True)
                        raise

                logger.info("CDE Pipeline completed successfully")
            finally:
                _publish_log_artifact(log_path)

    def create_process_work_pool(self, pool_name="cde-process-pool"):
        """Create the `process` work pool (idempotent; safe under concurrent replicas)."""
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
                        # Must use 'uv run' because prefect lives in the uv venv.
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
                # Another replica may have won the create race; treat as success.
                if "already exists" in str(e).lower():
                    logger.info("CDE process work pool created concurrently: %s", pool_name)
                else:
                    raise

    def create_deployment(self):
        """Register the work pool + all deployments (idempotent)."""
        self.create_process_work_pool(POOL_NAME)

        # Flow code is loaded from the package dir baked into the image, resolved
        # from this module's location so it works locally and on every worker.
        source_dir = str(Path(__file__).resolve().parent.parent)

        # Surface stdlib logging from non-flow code in the Prefect UI; everything
        # else is inherited from the worker container's env.
        job_vars = {
            "env": {
                "PREFECT_LOGGING_EXTRA_LOGGERS": "populate_vernaculars,cde_db_loader,cde_harvester",
            },
        }

        # Deploy cde_pipeline_run (a plain @flow function) — Prefect can't fill
        # `self` for the bound-method flow.
        # All-sources harvest in one run, on-demand only (the orchestrator carries the schedule).
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

        # Post-harvest WoRMS vernaculars backfill on its own schedule.
        vernaculars_id = flow.from_source(
            source=source_dir,
            entrypoint="cde_harvester/prefect_pipeline.py:populate_vernaculars_run",
        ).deploy(
            name="populate-vernaculars-deployment",
            work_pool_name=POOL_NAME,
            cron=_cron_env("VERNACULARS_CRON"),
            job_variables=job_vars,
        )

        # One on-demand deployment per source (re-deploy updates rather than
        # duplicates). The dashboard "Trigger harvest" button and the orchestrator
        # both run these by name; each forces incremental db-load (see cde_pipeline).
        per_source = [u.strip() for u in (self.erddap_urls or "").split(",") if u.strip()]
        if self.obis_dataset_ids:
            per_source.append("obis")
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

        # Scheduled fan-out orchestrator: on each HARVESTER_CRON tick it triggers
        # the per-source deployments above (registered first so they resolve at run time).
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
            "populate-vernaculars=%s per-source=%s",
            harvest_id, orchestrator_id, vernaculars_id, source_deployment_names,
        )
        return harvest_id


def _normalize_coolify_multiline(value: str) -> str:
    """Strip the uniform leading indent Coolify prepends to multi-line env var continuations."""
    lines = value.split("\n")
    if len(lines) <= 1:
        return value
    continuation = [ln for ln in lines[1:] if ln.strip()]
    if not continuation:
        return value
    min_indent = min(len(ln) - len(ln.lstrip(" ")) for ln in continuation)
    first_indent = len(lines[0]) - len(lines[0].lstrip(" "))
    # Only strip when the first line is less-indented than the block (Coolify's signature).
    if first_indent >= min_indent or min_indent == 0:
        return value
    return "\n".join(
        [lines[0]] + [ln[min_indent:] if ln.strip() else ln for ln in lines[1:]]
    )


def _resolve_harvest_config_file(config_file):
    """Resolve effective config: HARVEST_CONFIG_YAML env > mounted/baked-in default.

    Also writes OBIS_DATASETS_JSON to /tmp/Obis_Datasets.json when set.
    """
    env_config = os.getenv("HARVEST_CONFIG_YAML", "").strip()
    if env_config:
        # Coolify indents multi-line env var continuations; strip it so the YAML parses.
        env_config = _normalize_coolify_multiline(env_config)
        env_config_path = Path("/tmp/harvest_config_from_env.yaml")
        env_config_path.write_text(env_config)
        config_file = str(env_config_path)
        logger.info(f"Using HARVEST_CONFIG_YAML env var ({len(env_config)} bytes -> {env_config_path})")
    else:
        logger.info(f"Using harvest config file: {config_file}")

    env_obis = os.getenv("OBIS_DATASETS_JSON", "").strip()
    if env_obis:
        Path("/tmp/Obis_Datasets.json").write_text(env_obis)
        logger.info(f"Wrote OBIS_DATASETS_JSON env var ({len(env_obis)} bytes -> /tmp/Obis_Datasets.json)")
    return config_file


def _pipeline_run_name():
    """Per-run label: every ERDDAP source -> 'harvest-erddap-{full-host}'
    (host with dots replaced by dashes), OBIS -> 'harvest-obis', full run ->
    'harvest-full'. This sets only the flow_run_name — the flow NAME stays
    'Harvest Source' so the dashboard deployment lookup still works."""
    from prefect.runtime import flow_run

    source = (flow_run.parameters or {}).get("source")
    if not source:
        return "harvest-full"
    slug = deployment_slug(source)  # full host, dots -> dashes (e.g. erddap-amundsenscience-com)
    if slug == "obis":
        return "harvest-obis"
    return f"harvest-erddap-{slug}"


@flow(name="Harvest Source", flow_run_name=_pipeline_run_name, log_prints=True)
def cde_pipeline_run(
    config_file: str = "/app/harvester/harvest_config.yaml",
    source: str | None = None,
    triggered_by: str | None = None,
):
    """Deployable entry point. `source` (None = full) narrows to one ERDDAP url or 'obis';
    `triggered_by` is recorded on the audit row. Single-source runs force incremental db-load."""
    config_file = _resolve_harvest_config_file(config_file)
    pipeline = PrefectCDEPipeline()
    pipeline.init_config(config_file=config_file)
    pipeline.source = source
    pipeline.triggered_by = triggered_by
    pipeline.cde_pipeline()


@task(name="trigger-source-harvest")
def _trigger_source_harvest(source: str, triggered_by: str | None = None):
    """Run the per-source deployment for `source` and wait; return a status dict (never raises)."""
    deployment_name = f"{HARVEST_FLOW_NAME}/cde-harvester-{deployment_slug(source)}"
    params = {"source": source}
    if triggered_by:
        params["triggered_by"] = triggered_by
    try:
        flow_run = run_deployment(name=deployment_name, parameters=params)
    except Exception as e:  # deployment missing / API error — report, don't abort the batch
        return {"source": source, "deployment": deployment_name,
                "flow_run_id": None, "state": "TRIGGER_ERROR", "error": str(e)}
    state = flow_run.state
    return {
        "source": source,
        "deployment": deployment_name,
        "flow_run_id": str(flow_run.id),
        "flow_run_name": flow_run.name,
        "state": state.name if state else "UNKNOWN",
        "completed": bool(state and state.is_completed()),
    }


@flow(name="Harvest All Sources", log_prints=True)
def cde_harvest_all_run(
    config_file: str = "/app/harvester/harvest_config.yaml",
    triggered_by: str | None = None,
):
    """Scheduled fan-out: trigger one independent per-source harvest job per configured source,
    wait for all, and fail red if any did not complete (a failure doesn't cancel the others)."""
    logger = get_run_logger()

    config_file = _resolve_harvest_config_file(config_file)
    config = load_config(config_file)

    sources = [u.strip() for u in (config.get("erddap_urls") or []) if u and u.strip()]
    obis_ids = load_obis_dataset_ids(
        dataset_ids=config.get("obis_dataset_ids"),
        datasets_file=config.get("obis_datasets_file"),
    )
    if obis_ids:
        sources.append("obis")
    if not sources:
        raise ValueError("No sources configured to harvest (erddap_urls / obis_dataset_ids)")

    logger.info("Fanning out %d per-source harvest job(s): %s", len(sources), sources)
    futures = [_trigger_source_harvest.submit(src, triggered_by) for src in sources]
    results = [f.result() for f in futures]

    for r in results:
        logger.info("Source %s -> %s [%s] (flow_run=%s)",
                    r["source"], r["deployment"], r["state"], r.get("flow_run_id"))
    failed = [r for r in results if not r.get("completed")]
    if failed:
        raise RuntimeError(
            f"{len(failed)}/{len(sources)} per-source harvest job(s) did not complete: "
            + ", ".join(f"{r['source']}={r['state']}" for r in failed)
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
    for name in ("populate_vernaculars", "cde_db_loader", "cde_harvester"):
        logging.getLogger(name).setLevel(logging.INFO)

    from cde_db_loader.populate_vernaculars import main as vernaculars_main

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


def deploy(pipeline):
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

    if not args.file:
        logger.error("No config file provided. Use -f to specify harvest_config.yaml")
        sys.exit(1)
    try:
        if args.deployment == "prod":
            # 'prod' only REGISTERS deployments and exits; the worker runs them.
            pipeline = PrefectCDEPipeline()
            pipeline.init_config(config_file=args.file)
            deploy(pipeline)
        else:
            # Local full run: go through the Harvest Source flow so init/harvest/
            # load all execute inside a flow context (the harvest .submit() tasks
            # need a task runner).
            cde_pipeline_run(config_file=args.file)
    except Exception as e:
        logger.error(f"CDE Pipeline failed: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
