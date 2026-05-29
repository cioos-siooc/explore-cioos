"""FastAPI app exposing the CIOOS harvest-status dashboard.

Routes
------
GET /                                    overview: cards per ERDDAP server + recent runs
GET /server/{slug}                       all datasets on one server + sparklines (HTMX-filterable)
POST /server/{slug}/trigger              trigger a single-source harvest (Prefect); HTMX partial. Gated by HARVEST_TRIGGER_ENABLED
GET /server/{slug}/rows                  HTMX partial: dataset rows only (used by filter form)
GET /dataset/{slug}/{dataset_id}         full attempt history for one dataset
GET /runs/{run_id}                       all attempts in a single harvest run
GET /api/servers                         JSON
GET /api/server/{slug}                   JSON
GET /api/dataset/{slug}/{dataset_id}     JSON
GET /api/runs/{run_id}                   JSON
GET /healthz                             liveness
"""

import datetime as _dt
import json
import uuid as _uuid
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from . import config, prefect_client, queries
from .slug import slugify, unslug


class _JSONEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, (_dt.datetime, _dt.date)):
            return o.isoformat()
        if isinstance(o, _uuid.UUID):
            return str(o)
        if isinstance(o, Decimal):
            return float(o)
        return super().default(o)


def _json(payload, status_code: int = 200) -> Response:
    """JSONResponse that copes with datetime / Decimal."""
    return Response(
        content=json.dumps(payload, cls=_JSONEncoder),
        media_type="application/json",
        status_code=status_code,
    )

app = FastAPI(
    title="CIOOS Harvest Status",
    description="Per-run harvest history for every dataset across all configured data sources.",
)

TEMPLATES_DIR = Path(__file__).parent / "templates"
STATIC_DIR = Path(__file__).parent / "static"
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))
templates.env.filters["slugify"] = slugify

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


def _hostname(url: str) -> str:
    """Friendly hostname for the cards (e.g. 'data.cioospacific.ca')."""
    try:
        return urlparse(url).hostname or url
    except Exception:
        return url


# Known ERDDAP hostnames whose stored value pre-dates the full-URL migration.
# Maps bare hostname → canonical base URL. Anything not in here gets
# `https://<host>/erddap` as a best-effort fallback.
_LEGACY_ERDDAP_BASE = {
    "data.cioospacific.ca":   "https://data.cioospacific.ca/erddap",
    "catalogue.hakai.org":    "https://catalogue.hakai.org/erddap",
    "www.smartatlantic.ca":   "https://www.smartatlantic.ca/erddap",
    "cioosatlantic.ca":       "https://cioosatlantic.ca/erddap",
    "erddap.ogsl.ca":         "https://erddap.ogsl.ca/erddap",
    "dap.onc.uvic.ca":        "http://dap.onc.uvic.ca/erddap",
    "erddap.amundsenscience.com": "https://erddap.amundsenscience.com/erddap",
    "seagull-erddap.glos.org":    "https://seagull-erddap.glos.org/erddap",
}


def _ensure_scheme(url: str) -> str:
    """Guarantee an absolute URL with scheme. Without this, templates that
    interpolate erddap_url into href="" produce relative links that resolve
    against /server/<slug>, breaking outbound links."""
    if not url:
        return ""
    if url.startswith(("http://", "https://")):
        return url.rstrip("/")
    return _LEGACY_ERDDAP_BASE.get(url, f"https://{url}/erddap").rstrip("/")


def _dataset_link(url: str, dataset_id: str = "", source: str = "erddap") -> str:
    """Build a deep-link to the dataset on its source provider.

    For ERDDAP sources, this is `<base>/tabledap/<id>.html`.
    For OBIS, the audit row stores `https://obis.org` and the dataset_id is
    the OBIS UUID — link to the public OBIS dataset page.
    """
    base = _ensure_scheme(url)
    if not dataset_id:
        return base
    if source == "obis":
        return f"https://obis.org/dataset/{dataset_id}"
    return f"{base}/tabledap/{dataset_id}.html"


def _source_label(source: str) -> str:
    """Display label for the link `view on …`."""
    return {"obis": "OBIS", "erddap": "ERDDAP"}.get(source or "", (source or "source").upper())


def _split_urls(blob: str | None) -> list[str]:
    """harvest_attempts.query_urls is stored as a newline-joined text blob."""
    if not blob:
        return []
    return [line.strip() for line in blob.splitlines() if line.strip()]


def _fmt_dt(value, fmt: str = "%Y-%m-%d %H:%M UTC", default: str = "—") -> str:
    """Format a timestamp that may arrive as a datetime or an ISO string.

    The audit tables are timestamptz per schema, but a DB whose harvest
    tables were auto-created from the CSV loader stores them as text, so the
    value can come back as a string. Handle both rather than assume a type.
    """
    if value is None or value == "":
        return default
    if isinstance(value, str):
        try:
            value = _dt.datetime.fromisoformat(value)
        except ValueError:
            return value
    return value.strftime(fmt)


templates.env.filters["dt"] = _fmt_dt
templates.env.filters["hostname"] = _hostname
templates.env.filters["abs_url"]  = _ensure_scheme
templates.env.filters["dataset_link"] = _dataset_link
templates.env.filters["source_label"] = _source_label
templates.env.filters["split_urls"] = _split_urls
templates.env.filters["prefect_run_url"] = config.prefect_run_url


@app.get("/healthz")
def healthz():
    return {"ok": True}


# ---------- HTML views ----------

@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    servers = queries.list_servers()
    runs = queries.recent_runs()
    reasons = queries.reason_code_breakdown()
    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "servers": servers,
            "runs": runs,
            "reasons": reasons,
            "n_servers": len(servers),
        },
    )


@app.get("/server/{slug}", response_class=HTMLResponse)
def server(request: Request, slug: str,
           status: str | None = Query(default=None),
           q: str | None = Query(default=None)):
    erddap_url = unslug(slug)
    datasets = queries.server_datasets(erddap_url, status_filter=status, q=q)
    reasons = queries.reason_code_breakdown(erddap_url)
    summary = _summarize_statuses(datasets)
    return templates.TemplateResponse(
        request,
        "server.html",
        {
            "erddap_url": erddap_url,
            "slug": slug,
            "datasets": datasets,
            "reasons": reasons,
            "summary": summary,
            "status": status or "",
            "q": q or "",
            "trigger_enabled": config.HARVEST_TRIGGER_ENABLED,
        },
    )


@app.post("/server/{slug}/trigger", response_class=HTMLResponse)
def trigger_server_harvest(request: Request, slug: str):
    """Trigger a single-source harvest for this server via the Prefect API.

    Access is already gated by Cloudflare Access (CIOOS accounts); this is the
    only non-GET route. HARVEST_TRIGGER_ENABLED is a per-environment kill-switch.
    The run is attributed to the Cloudflare-Access user. Always returns a 200
    HTMX partial (success link or styled error) so the result swaps in cleanly.
    """
    erddap_url = unslug(slug)
    if not config.HARVEST_TRIGGER_ENABLED:
        # Return the HTML partial (200) rather than HTTPException(403)'s JSON, so
        # HTMX swaps a readable message into #trigger-result. The button is also
        # hidden when disabled, so this is just defense-in-depth.
        return templates.TemplateResponse(
            request,
            "_trigger_result.html",
            {"ok": False, "error": "Harvest triggering is disabled (HARVEST_TRIGGER_ENABLED=false).",
             "hostname": _hostname(erddap_url)},
        )
    source = config.source_for(erddap_url)
    triggered_by = (
        request.headers.get("Cf-Access-Authenticated-User-Email")
        or request.headers.get("X-Forwarded-User")
        or None
    )
    try:
        result = prefect_client.trigger_source_harvest(source, triggered_by=triggered_by)
        ctx = {
            "ok": True,
            "result": result,
            "run_url": config.prefect_run_url(result["flow_run_id"]),
            "hostname": _hostname(erddap_url),
            "triggered_by": triggered_by,
        }
    except prefect_client.PrefectError as e:
        ctx = {"ok": False, "error": str(e), "hostname": _hostname(erddap_url)}
    return templates.TemplateResponse(request, "_trigger_result.html", ctx)


@app.get("/server/{slug}/rows", response_class=HTMLResponse)
def server_rows(request: Request, slug: str,
                status: str | None = Query(default=None),
                q: str | None = Query(default=None)):
    """HTMX partial — just the <tbody> rows, hot-swapped by the filter form."""
    erddap_url = unslug(slug)
    datasets = queries.server_datasets(erddap_url, status_filter=status, q=q)
    return templates.TemplateResponse(
        request,
        "_dataset_rows.html",
        {"datasets": datasets, "slug": slug},
    )


@app.get("/dataset/{slug}/{dataset_id}", response_class=HTMLResponse)
def dataset(request: Request, slug: str, dataset_id: str):
    erddap_url = unslug(slug)
    history = queries.dataset_history(erddap_url, dataset_id)
    if not history:
        raise HTTPException(
            status_code=404,
            detail=f"No harvest history for dataset_id={dataset_id!r} on {erddap_url}",
        )
    return templates.TemplateResponse(
        request,
        "dataset.html",
        {
            "erddap_url": erddap_url,
            "slug": slug,
            "dataset_id": dataset_id,
            "history": history,
            "latest": history[0],
        },
    )


@app.get("/runs/{run_id}", response_class=HTMLResponse)
def run(request: Request, run_id: str):
    run = queries.run_detail(run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"No run {run_id}")
    attempts = queries.run_attempts(run_id)
    summary = _summarize_statuses(attempts)
    return templates.TemplateResponse(
        request,
        "run.html",
        {"run": run, "attempts": attempts, "summary": summary},
    )


# ---------- JSON API ----------

@app.get("/api/servers")
def api_servers():
    return _json(queries.list_servers())


@app.get("/api/server/{slug}")
def api_server(slug: str,
               status: str | None = Query(default=None),
               q: str | None = Query(default=None)):
    return _json(queries.server_datasets(unslug(slug), status_filter=status, q=q))


@app.get("/api/dataset/{slug}/{dataset_id}")
def api_dataset(slug: str, dataset_id: str):
    history = queries.dataset_history(unslug(slug), dataset_id)
    if not history:
        raise HTTPException(status_code=404, detail="No history")
    return _json(history)


@app.get("/api/runs/{run_id}")
def api_run(run_id: str):
    run = queries.run_detail(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="No run")
    return _json({"run": run, "attempts": queries.run_attempts(run_id)})


# ---------- helpers ----------

def _summarize_statuses(rows):
    out = {"success": 0, "skipped": 0, "error": 0, "total": len(rows)}
    for r in rows:
        s = r.get("status")
        if s in out:
            out[s] += 1
    return out


@app.exception_handler(404)
async def not_found(request: Request, exc: HTTPException):
    if request.url.path.startswith("/api/"):
        return JSONResponse({"detail": exc.detail}, status_code=404)
    return templates.TemplateResponse(
        request,
        "404.html",
        {"detail": exc.detail},
        status_code=404,
    )
