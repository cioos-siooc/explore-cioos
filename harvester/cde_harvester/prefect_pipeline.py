#!/usr/bin/env python3
from prefect import flow, get_run_logger
from cde_harvester.__main__ import main as harvester_main, setup_logging, load_config, load_obis_dataset_ids
from cde_harvester.redisFunctions import redisFlow
from cde_db_loader.__main__ import main as db_loader_main
from dotenv import load_dotenv
import logging
import os
import argparse
import shutil
import sys
import time
import uuid
from prefect.client.orchestration import get_client
from prefect.client.schemas.actions import WorkPoolCreate
from prefect.exceptions import ObjectNotFound
from urllib.parse import urlparse

load_dotenv()

logger = logging.getLogger(__name__)

# OBIS is a single monolithic source; aliases the dashboard / a deployment may
# pass for it. Kept in sync with cde_harvester.__main__._OBIS_ALIASES.
_OBIS_ALIASES = {"obis", "https://obis.org", "http://obis.org", "obis.org"}


# Prefect process work pool the worker(s) poll and all deployments register
# against. Workers run flows in-process (no spawned containers / docker socket),
# which is what lets them scale via compose replicas and run on a remote host.
POOL_NAME = "cde-process-pool"

RUN_FOLDER_PREFIX = "run-"
KEEP_RUN_FOLDERS = 5  # retain this many recent per-run output folders
# Never prune a folder modified within this window — protects a concurrent
# in-flight run (harvests can take ~1h) from being deleted by another run's prune.
PRUNE_GRACE_SECONDS = 6 * 3600


def _run_subfolder(base_folder, run_token):
    """Per-run output folder under the shared harvest volume."""
    return os.path.join(base_folder, f"{RUN_FOLDER_PREFIX}{run_token}")


def _prune_run_folders(base_folder, keep=KEEP_RUN_FOLDERS, protect=None):
    """Keep the newest `keep` per-run output folders; reclaim the older ones so
    the harvest volume doesn't grow unbounded.

    Only ever touches our own run-* directories — never the base folder, the
    OBIS cache, the current run's folder (`protect`), or any folder modified
    within the grace window (so a concurrent in-flight run is never deleted)."""
    protect = os.path.abspath(protect) if protect else None
    try:
        runs = [
            (os.path.getmtime(os.path.join(base_folder, n)), os.path.abspath(os.path.join(base_folder, n)))
            for n in os.listdir(base_folder)
            if n.startswith(RUN_FOLDER_PREFIX)
            and os.path.isdir(os.path.join(base_folder, n))
        ]
    except FileNotFoundError:
        return
    now = time.time()
    for mtime, path in sorted(runs, reverse=True)[keep:]:
        if path == protect or (now - mtime) <= PRUNE_GRACE_SECONDS:
            continue  # current run, or too recent to be sure it's idle
        try:
            shutil.rmtree(path)
            logger.info("Pruned old harvest run folder: %s", path)
        except OSError as e:
            logger.warning("Could not prune run folder %s: %s", path, e)


def deployment_slug(source):
    """Stable slug for a per-source deployment name.

    MUST match the dashboard's derivation (harvest-dashboard/app/config.py) so a
    dashboard-triggered run lands on the same per-source deployment as one
    triggered from the Prefect UI. OBIS -> 'obis'; an ERDDAP url -> its hostname
    with dots replaced by dashes, lowercased (e.g.
    'https://erddap.ogsl.ca/erddap' -> 'erddap-ogsl-ca').
    """
    if not source or str(source).strip().lower() in _OBIS_ALIASES:
        return "obis"
    host = urlparse(source if "://" in source else "https://" + source).hostname or str(source)
    return host.lower().replace(".", "-")

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
    # Single-source run controls (None = full harvest of all configured sources).
    source: str
    triggered_by: str

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
        # Default to a full harvest; cde_pipeline_run() overrides these for a
        # single-source (per-source deployment / dashboard-triggered) run.
        self.source = None
        self.triggered_by = None
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

        # Per-run output subfolder so concurrent harvests (e.g. an on-demand
        # single-source trigger overlapping the nightly full run) don't clobber
        # each other's CSVs in the shared harvest volume. The harvester writes
        # into run_folder and the db-loader reads from it, so the handoff stays
        # isolated per run.
        base_folder = self.folder
        try:
            from prefect.runtime import flow_run as _pf_flow_run
            run_token = _pf_flow_run.id or str(uuid.uuid4())
        except Exception:
            run_token = str(uuid.uuid4())
        run_folder = _run_subfolder(base_folder, run_token)
        # The OBIS occurrence cache must stay SHARED across runs (it's a cache,
        # keyed by dataset). main() derives it from `folder`'s parent when
        # obis_folder is unset — which would point inside the per-run subfolder
        # and miss the cache — so pin it to the base-folder derivation and pass
        # it explicitly. Matches harvester __main__ behaviour for the base run.
        obis_folder = self.obis_folder or os.path.join(
            os.path.dirname(os.path.abspath(base_folder)), "obis_cache"
        )
        # Invariant: the OBIS cache must live OUTSIDE the per-run folder tree, or
        # pruning (which rmtrees run-* dirs) could eventually delete it. Our
        # derivation puts it as a sibling of base_folder, so this always holds;
        # assert it so a future config/path change fails loudly, not silently.
        _abs_run, _abs_obis = os.path.abspath(run_folder), os.path.abspath(obis_folder)
        assert _abs_obis != _abs_run and not _abs_obis.startswith(_abs_run + os.sep), (
            f"OBIS cache {obis_folder} must not be inside the per-run folder {run_folder}"
        )
        logger.info("Run output folder: %s (shared OBIS cache: %s)", run_folder, obis_folder)

        # Run harvester as a subflow
        logger.info("Running cde_harvester subflow")
        try:
            harvester_main(
                erddap_urls=self.erddap_urls,
                cache_requests=self.cache_requests,
                folder=run_folder,
                dataset_ids=self.dataset_ids,
                obis_dataset_ids=self.obis_dataset_ids,
                obis_folder=obis_folder,
                source=self.source,
                triggered_by=self.triggered_by,
            )
            logger.info("cde_harvester completed successfully")
        except Exception as e:
            logger.error(f"cde_harvester failed: {e}", exc_info=True)
            raise

        # Run db_loader as a subflow.
        # CRITICAL: a single-source run must NEVER use full-reload mode, which
        # TRUNCATEs every table and would wipe all the OTHER sources. The
        # incremental path is per-(dataset_id, erddap_url) scoped and safe, so
        # force it whenever a source is set, regardless of config.
        effective_incremental = self.incremental or bool(self.source)
        if self.source and not self.incremental:
            logger.warning(
                "Single-source run (source=%s): forcing db-loader INCREMENTAL "
                "mode so the full-reload TRUNCATE can't wipe other sources.",
                self.source,
            )
        logger.info("Running cde_db_loader subflow")
        try:
            db_loader_main(folder=run_folder, incremental=effective_incremental)
            logger.info("cde_db_loader completed successfully")
            # Data is now in the DB; keep only the newest few run folders for
            # debugging/replay and reclaim volume space. protect=run_folder so
            # this run's own output is never pruned; kept on failure (above
            # raises) so a failed run's CSVs survive for investigation.
            _prune_run_folders(base_folder, protect=run_folder)
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
    
    @flow(name="Create Process Work Pool", log_prints=True)
    def create_process_work_pool(self, pool_name="cde-process-pool"):
        """Create a `process` work pool for Prefect deployments (idempotent).

        Flows run IN-PROCESS inside the worker container — no per-run containers,
        no docker socket. The worker supplies env (DB creds, REDIS_HOST, etc.)
        from its own container environment, so the job template is minimal: just
        the default ``uv run prefect flow-run execute`` command (prefect lives in
        the uv venv) plus the standard process knobs.

        Safe to call from every worker replica concurrently: an existing pool is
        left as-is, and the already-exists create race is swallowed."""

        # Minimal process-pool job template. `working_dir` is left to the
        # deployment's pull step (from_source set_working_directory).
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
                        # CRITICAL: Must use 'uv run' because prefect is in the venv
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

        # Use sync client for simplicity in this script
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
                # Another replica registering at the same instant may have won
                # the create. Treat "already exists" as success; re-raise others.
                if "already exists" in str(e).lower():
                    logger.info(
                        "CDE process work pool created concurrently by another "
                        "replica: %s", pool_name
                    )
                else:
                    raise
    
    @flow(name="Create Deployment", log_prints=True)
    def create_deployment(self):
        # Process-pool deployments. The flow runs IN-PROCESS inside the worker
        # container (no spawned flow-run containers), so there is no image,
        # network, or volume wiring here — the worker provides DB creds /
        # REDIS_HOST / HARVESTER_LOG_DIR / config-override env vars from its own
        # container environment (set in docker-compose), and the harvest volumes
        # are mounted on the worker itself. This is what lets a worker run on a
        # remote host: same image + PREFECT_API_URL + DB reachability is enough.
        self.create_process_work_pool(POOL_NAME)

        # from_source tells a worker how to LOAD the flow code. We point it at
        # the package directory baked into the image (/app/harvester). Every
        # worker — local or remote — runs the same image with code at the same
        # path, so the resulting set_working_directory pull step resolves on any
        # host. Derived from this module's location so local dev works too.
        source_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

        # Minimal per-run env. Merged on top of the worker's own environment, so
        # we only need the logging knob here: make stdlib `logging` from non-flow
        # code (harvester internals, db_loader, populate_vernaculars) surface in
        # the Prefect UI's flow-run logs. Everything else (DB creds, REDIS_HOST,
        # HARVEST_CONFIG_YAML, ...) is inherited from the worker container.
        job_vars = {
            "env": {
                "PREFECT_LOGGING_EXTRA_LOGGERS": (
                    "populate_vernaculars,cde_db_loader,cde_harvester"
                ),
            },
        }

        # Deployment 1: the harvest itself.
        # Deploy the top-level wrapper flow (not the bound method) — Prefect's
        # deployment runner can't fill `self` for class-method flows, so we
        # use cde_pipeline_run which is a regular @flow function.
        harvest_id = flow.from_source(
            source=source_dir,
            entrypoint="cde_harvester/prefect_pipeline.py:cde_pipeline_run",
        ).deploy(
            name="cde-harvester-deployment",
            work_pool_name=POOL_NAME,
            cron=os.getenv("HARVESTER_CRON"),
            parameters={
                "config_file": "/app/harvester/harvest_config.yaml",
            },
            job_variables=job_vars,
        )

        # Deployment 2: post-harvest WoRMS lookup that populates
        # cde.scientific_name_vernaculars. Independent schedule (VERNACULARS_CRON)
        # because the WoRMS API is slow and operators may want to backfill out
        # of band. Idempotent + resumable, so re-running is safe.
        vernaculars_id = flow.from_source(
            source=source_dir,
            entrypoint="cde_harvester/prefect_pipeline.py:populate_vernaculars_run",
        ).deploy(
            name="populate-vernaculars-deployment",
            work_pool_name=POOL_NAME,
            cron=os.getenv("VERNACULARS_CRON"),
            job_variables=job_vars,
        )

        # Deployments 3..N: one per source, ON-DEMAND (no cron). These let an
        # operator re-harvest a single ERDDAP server (or OBIS) independently —
        # from the Prefect UI or the dashboard "Trigger harvest" button —
        # without re-running everything. The source list is taken from the
        # already-loaded config (init_config runs before create_deployment), so
        # adding a server to harvest_config.yaml auto-creates its deployment on
        # the next registration. Re-running .deploy() with the same name UPDATES
        # rather than duplicates. Each run forces incremental db-load (see
        # cde_pipeline) so it can never TRUNCATE the other sources.
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
                cron=None,  # on-demand only
                parameters={
                    "config_file": "/app/harvester/harvest_config.yaml",
                    "source": src,
                },
                job_variables=job_vars,
            )
            source_deployment_names.append(dep_name)
            logger.info("Per-source deployment registered: %s (source=%s)", dep_name, src)

        print("\nTo start a worker, run:")
        print(f"  uv run prefect worker start --pool {POOL_NAME} --type process")
        logger.info(
            "Deployments created: cde-harvester=%s populate-vernaculars=%s per-source=%s",
            harvest_id, vernaculars_id, source_deployment_names,
        )
        return harvest_id

def _normalize_coolify_multiline(value: str) -> str:
    """Strip the leading indent Coolify's .env writer prepends to every
    continuation line of multi-line env vars.

    Example input (Coolify .env output):
        erddap_urls:
              - https://a
              - https://b

          cache: true
          folder:

    Example output:
        erddap_urls:
            - https://a
            - https://b

        cache: true
        folder:
    """
    lines = value.split("\n")
    if len(lines) <= 1:
        return value
    continuation = [ln for ln in lines[1:] if ln.strip()]
    if not continuation:
        return value
    indents = [len(ln) - len(ln.lstrip(" ")) for ln in continuation]
    min_indent = min(indents)
    first_indent = len(lines[0]) - len(lines[0].lstrip(" "))
    # Only strip if the first line is less-indented than the continuation
    # block — that's the signature of Coolify's added indent (where the
    # value-start sits flush with `KEY='`, but every later line is shifted).
    if first_indent >= min_indent or min_indent == 0:
        return value
    return "\n".join(
        [lines[0]]
        + [ln[min_indent:] if ln.strip() else ln for ln in lines[1:]]
    )


@flow(name="CDE Pipeline Run", log_prints=True)
def cde_pipeline_run(
    config_file: str = "/app/harvester/harvest_config.yaml",
    source: str | None = None,
    triggered_by: str | None = None,
):
    """Deployable entry point for the harvest pipeline.

    ``source`` (None = full harvest) narrows the run to a single source: an
    ERDDAP url (full url, hostname, or the dashboard's base64 slug) or the
    literal 'obis'. Per-source deployments set it; the dashboard passes it (plus
    ``triggered_by`` = the Cloudflare-Access user email) when an operator clicks
    "Trigger harvest". A single-source run is forced to incremental db-load so
    it can't TRUNCATE the other sources.

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
        # Coolify's .env writer prepends a fixed leading indent (typically
        # 2 spaces) to every continuation line of a multi-line env var,
        # while leaving the first line flush with the opening quote. That
        # corrupts a YAML document whose top-level keys were at column 0:
        # they end up at column 2, breaking the parse.
        # Detect + strip that added indent so the YAML round-trips cleanly.
        env_config = _normalize_coolify_multiline(env_config)

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
    pipeline.source = source
    pipeline.triggered_by = triggered_by
    pipeline.cde_pipeline()


@flow(name="Populate Vernaculars", log_prints=True)
def populate_vernaculars_run(
    top: int = 0,
    limit: int = 0,
    workers: int = 8,
    batch_size: int = 50,
    refresh_status: str = "",
):
    """Populate cde.scientific_name_vernaculars from WoRMS (marinespecies.org).

    Wraps db-loader/cde_db_loader/populate_vernaculars.py so it can be run as
    a Prefect deployment alongside the harvest. Idempotent + resumable: only
    names missing from the cache table are processed unless refresh_status is
    set. WoRMS calls are slow (~300 ms each) so a full run can take a while —
    use top=N for a triage backfill.

    Parameters (Prefect-UI overridable via "Custom Run"):
      top: only the N most-common species (0 = all)
      limit: hard cap on rows processed this run (0 = no cap)
      workers: parallel threads for WoRMS API calls (default 8)
      batch_size: names per AphiaRecordsByMatchNames batch, max 50
      refresh_status: re-fetch rows whose previous status matches, e.g.
                      "error" or "error,not_found" ("" = only fetch new)
    """
    # populate_vernaculars uses argparse. Monkey-patch sys.argv so we don't
    # have to refactor the script's CLI surface.
    import logging as _logging

    # PREFECT_LOGGING_EXTRA_LOGGERS attaches Prefect's handler to these
    # loggers but does NOT change their level. Without explicit INFO, the
    # script's `logger.info(...)` progress lines get filtered out before
    # they reach Prefect's handler — silent flow run.
    for name in ("populate_vernaculars", "cde_db_loader", "cde_harvester"):
        _logging.getLogger(name).setLevel(_logging.INFO)

    from cde_db_loader.populate_vernaculars import main as vernaculars_main

    argv = ["populate_vernaculars"]
    if top > 0:
        argv += ["--top", str(top)]
    if limit > 0:
        argv += ["--limit", str(limit)]
    argv += ["--workers", str(workers), "--batch-size", str(batch_size)]
    if refresh_status:
        argv += ["--refresh-status", refresh_status]

    # print() lines are captured by @flow(log_prints=True) → visible in the
    # Prefect UI even if logging is misconfigured. Useful as a heartbeat /
    # canary so a stuck WoRMS call doesn't look identical to a stuck flow.
    print(f"populate_vernaculars argv: {argv}")
    print("Calling vernaculars_main() — output below comes from the stdlib "
          "logger 'populate_vernaculars' via PREFECT_LOGGING_EXTRA_LOGGERS")

    saved_argv = sys.argv
    try:
        sys.argv = argv
        vernaculars_main()
    finally:
        sys.argv = saved_argv

    print("vernaculars_main() returned")


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
