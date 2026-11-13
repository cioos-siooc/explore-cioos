from types import SimpleNamespace

import pandas as pd
import pytest
from cde_harvester import __main__ as harvester

SOURCE = "https://data.example.org/erddap"


@pytest.fixture
def nothing_harvested(mocker):
    empty = SimpleNamespace(**{
        name: pd.DataFrame()
        for name in (
            "profiles", "trajectory_days", "trajectory_points", "datasets",
            "variables", "skipped", "attempts", "verified",
        )
    })
    mocker.patch.object(harvester, "_run_logger", return_value=mocker.Mock())
    mocker.patch.object(harvester.harvest_erddap, "submit").return_value.result.return_value = empty
    audit = mocker.patch.object(harvester, "_write_run_audit_csvs")
    write = mocker.patch.object(harvester.merge_and_write_csvs, "submit")
    return SimpleNamespace(audit=audit, write=write)


def _run(tmp_path, source=None):
    harvester.main(
        erddap_urls=SOURCE, cache_requests=False, folder=str(tmp_path / "run"),
        dataset_ids=None, source=source,
    )


def test_full_run_with_nothing_harvested_fails(tmp_path, nothing_harvested):
    with pytest.raises(RuntimeError, match="No datasets harvested"):
        _run(tmp_path)
    assert nothing_harvested.audit.call_args.kwargs["status"] == "failed"
    nothing_harvested.write.assert_not_called()


def test_single_source_with_nothing_harvested_still_loads_its_attempts(
    tmp_path, nothing_harvested
):
    _run(tmp_path, source=SOURCE)
    nothing_harvested.write.assert_called_once()
    assert nothing_harvested.audit.call_args.kwargs["status"] == "ok"
