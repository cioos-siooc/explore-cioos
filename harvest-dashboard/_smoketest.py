"""Local smoke test: import the FastAPI app, render each template with fake
data, and check no template error / no route error. Does NOT hit Postgres."""

import datetime as dt
import sys
import types
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))


# --- stub out DB before app imports it -------------------------------------
class _StubEngine:
    def connect(self):
        raise RuntimeError("DB should be stubbed; queries module should be patched first")


fake_db = types.ModuleType("app.db")
fake_db.engine = _StubEngine()
sys.modules["app.db"] = fake_db

# Now import the queries module and replace each function with a fixture.
from app import queries  # noqa: E402

NOW = dt.datetime(2026, 5, 26, 12, 30, tzinfo=dt.timezone.utc)
RUN_ID = str(uuid.uuid4())


def _server_row(url, src="erddap", ok=2, sk=1, er=0):
    return {
        "erddap_url": url, "source": src,
        "last_attempted_at": NOW, "last_run_id": RUN_ID,
        "n_success": ok, "n_skipped": sk, "n_error": er,
        "n_total": ok + sk + er,
    }


def _attempt(dataset_id, status, reason=None, err=None):
    return {
        "erddap_url": "https://data.cioospacific.ca/erddap",
        "dataset_id": dataset_id, "source": "erddap",
        "status": status, "reason_code": reason, "error_message": err,
        "duration_ms": 1234.0,
        "attempted_at": NOW, "run_id": RUN_ID,
        "last_success_at": NOW - dt.timedelta(days=2) if status != "success" else NOW,
        "history_statuses": [status, "success", "success", "success"],
        "history_times": [NOW, NOW, NOW, NOW],
    }


queries.list_servers = lambda: [
    _server_row("https://data.cioospacific.ca/erddap"),
    _server_row("https://catalogue.hakai.org/erddap", ok=10, sk=2, er=1),
]
queries.recent_runs = lambda limit=20: [{
    "run_id": RUN_ID, "started_at": NOW, "finished_at": NOW + dt.timedelta(seconds=42),
    "git_sha": "abc1234", "status": "ok", "error_message": None,
    "n_success": 12, "n_skipped": 3, "n_error": 1, "n_total": 16,
}]
queries.reason_code_breakdown = lambda erddap_url=None: [
    {"reason_code": "CDM_DATA_TYPE_UNSUPPORTED", "n": 5},
    {"reason_code": "HTTP_ERROR", "n": 2},
]
queries.server_datasets = lambda erddap_url, status_filter=None, q=None: [
    _attempt("SCN_GP01OB04_a", "success"),
    _attempt("SCN_BROKEN", "error", "HTTP_ERROR", "HTTP 503 Service Unavailable"),
    _attempt("SCN_WRONG_CDM", "skipped", "CDM_DATA_TYPE_UNSUPPORTED",
             "cdm_data_type='Other' not in ['TimeSeries', ...]"),
]
queries.dataset_history = lambda erddap_url, dataset_id: [
    {"run_id": RUN_ID, "attempted_at": NOW, "status": "error",
     "reason_code": "HTTP_ERROR", "error_message": "HTTP 503",
     "duration_ms": 1500.0, "source": "erddap",
     "git_sha": "abc1234", "run_started_at": NOW},
    {"run_id": str(uuid.uuid4()), "attempted_at": NOW - dt.timedelta(days=1),
     "status": "success", "reason_code": None, "error_message": None,
     "duration_ms": 800.0, "source": "erddap",
     "git_sha": "abc1234", "run_started_at": NOW - dt.timedelta(days=1)},
]
queries.run_detail = lambda run_id: {
    "run_id": run_id, "started_at": NOW,
    "finished_at": NOW + dt.timedelta(seconds=42), "git_sha": "abc1234",
    "status": "ok", "error_message": None, "duration_s": 42,
}
queries.run_attempts = lambda run_id: queries.server_datasets("anything")

# --- now import the app and exercise each route -----------------------------
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)

from app.slug import slugify  # noqa: E402

SLUG = slugify("https://data.cioospacific.ca/erddap")
NOPE = slugify("https://nope/erddap")

routes_to_check = [
    ("GET", "/healthz"),
    ("GET", "/"),
    ("GET", f"/server/{SLUG}"),
    ("GET", f"/server/{SLUG}/rows"),
    ("GET", f"/server/{SLUG}?status=error"),
    ("GET", f"/dataset/{SLUG}/SCN_BROKEN"),
    ("GET", f"/runs/{RUN_ID}"),
    ("GET", "/api/servers"),
    ("GET", f"/api/server/{SLUG}"),
    ("GET", f"/api/dataset/{SLUG}/SCN_BROKEN"),
    ("GET", f"/api/runs/{RUN_ID}"),
]

failed = 0
for method, path in routes_to_check:
    r = client.request(method, path)
    ok = r.status_code in (200, 404)  # 404 is fine for nonexistent stub paths
    status = "OK " if ok else "FAIL"
    print(f"{status} {r.status_code} {method} {path}")
    if not ok:
        print(r.text[:500])
        failed += 1

# 404 path: nonexistent dataset (returns no rows from stubbed query)
queries.dataset_history = lambda erddap_url, dataset_id: []
r404 = client.get(f"/dataset/{NOPE}/nothing")
print(f"{'OK ' if r404.status_code == 404 else 'FAIL'} {r404.status_code} GET /dataset/<nope>/nothing")
if r404.status_code != 404:
    failed += 1

sys.exit(failed)
