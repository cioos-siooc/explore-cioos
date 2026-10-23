"""plan_resume: what a restarted worker reruns of the runs its predecessor left RUNNING."""
from datetime import UTC, datetime

from cde_harvester.prefect_recovery import HARVEST_ALL_DEPLOYMENT, Orphan, Resume, plan_resume

GLOS = "https://seagull-erddap.glos.org/erddap"
ONC = "https://dap.oceannetworks.ca/erddap"
CEOTR = "https://data.ceotr.ca/erddap"
CONFIGURED = [CEOTR, GLOS, ONC, "obis"]
STARTED = datetime(2026, 10, 21, 15, 55, tzinfo=UTC)
CONFIG = "/app/harvester/harvest_config.yaml"


def child(source, run_id, parent=None):
    slug = "obis" if source == "obis" else source.split("//")[1].split("/")[0].replace(".", "-")
    return Orphan(
        id=run_id,
        deployment=f"Harvest Source/cde-harvester-{slug}",
        parameters={"config_file": CONFIG, "source": source},
        started=STARTED,
        parent_flow_run_id=parent,
    )


def orchestrator(run_id="all-1", **params):
    return Orphan(
        id=run_id, deployment=HARVEST_ALL_DEPLOYMENT,
        parameters={"config_file": CONFIG, **params}, started=STARTED,
    )


def nothing_finished(since):
    return set()


def test_no_orphans_plans_nothing():
    assert plan_resume([], CONFIGURED, nothing_finished) == []


def test_a_standalone_source_run_reruns_as_it_was():
    plan = plan_resume([child(GLOS, "r1")], CONFIGURED, nothing_finished)
    assert plan == [Resume(
        "Harvest Source/cde-harvester-seagull-erddap-glos-org",
        {"config_file": CONFIG, "source": GLOS}, "resume-r1",
    )]


def test_children_fold_into_one_harvest_all_without_the_finished_sources():
    orphans = [orchestrator(triggered_by="ops"), child(GLOS, "c1", parent="all-1"), child("obis", "c2", parent="all-1")]
    finished = {"data-ceotr-ca"}

    plan = plan_resume(orphans, CONFIGURED, lambda since: finished if since == STARTED else set())

    assert plan == [Resume(
        HARVEST_ALL_DEPLOYMENT,
        {"config_file": CONFIG, "triggered_by": "ops", "sources": [GLOS, ONC, "obis"]},
        "resume-all-1",
    )]


def test_a_resumed_harvest_all_keeps_its_narrowed_sources():
    plan = plan_resume([orchestrator(sources=[GLOS, "obis"])], CONFIGURED, nothing_finished)
    assert plan[0].parameters["sources"] == [GLOS, "obis"]


def test_a_source_rerun_directly_is_not_also_in_the_harvest_all():
    orphans = [orchestrator(), child(GLOS, "manual")]

    plan = plan_resume(orphans, CONFIGURED, nothing_finished)

    assert [r.deployment for r in plan] == [
        "Harvest Source/cde-harvester-seagull-erddap-glos-org", HARVEST_ALL_DEPLOYMENT,
    ]
    assert plan[1].parameters["sources"] == [CEOTR, ONC, "obis"]


def test_two_orchestrators_resume_as_one():
    orphans = [orchestrator("a"), orchestrator("b", sources=[GLOS])]

    plan = plan_resume(orphans, CONFIGURED, nothing_finished)

    assert len(plan) == 1
    assert plan[0].parameters["sources"] == CONFIGURED
    assert plan[0].idempotency_key == "resume-a-b"


def test_everything_finished_reruns_nothing():
    plan = plan_resume(
        [orchestrator()], CONFIGURED,
        lambda since: {"data-ceotr-ca", "seagull-erddap-glos-org", "dap-oceannetworks-ca", "obis"},
    )
    assert plan == []


def test_rebuild_vernaculars_and_full_runs_are_never_rerun():
    orphans = [
        Orphan("rb", "Rebuild Database/cde-rebuild-database", {"confirm": "cde"}),
        Orphan("v", "Populate Vernaculars/populate-vernaculars-deployment"),
        Orphan("full", "Harvest Source/cde-harvester-deployment", {"config_file": CONFIG}),
        Orphan("adhoc", None, {"source": GLOS}),
    ]
    assert plan_resume(orphans, CONFIGURED, nothing_finished) == []
