"""
HarvestAnalyzer — inspects HarvestArtifacts and produces a structured list of
findings across six categories:

  1. Fatal / server-level failures
  2. HTTP errors and connectivity problems
  3. Data integrity issues in output DataFrames
  4. Known unhandled error patterns in log messages
  5. Performance anomalies (slow servers, oversized responses)
  6. Output completeness checks

Each finding has a severity (CRITICAL → INFO), category, human-readable title
and detail, and an optional list of affected dataset/server IDs.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import pandas as pd

from cde_harvester.harvest_errors import (
    CDM_DATA_TYPE_UNSUPPORTED,
    DEPTH_AND_ALTITUDE,
    HTTP_ERROR,
    INGEST_FLAG_FALSE,
    MISSING_REQUIRED_VARS,
    NO_SUPPORTED_VARIABLES,
    UNKNOWN_ERROR,
)


# ─── Severity constants ────────────────────────────────────────────────────────

CRITICAL = "CRITICAL"
HIGH     = "HIGH"
MEDIUM   = "MEDIUM"
LOW      = "LOW"
INFO     = "INFO"

_SEVERITY_RANK = {CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4}

# ─── Data classes ─────────────────────────────────────────────────────────────

@dataclass
class Finding:
    severity: str
    category: str
    title: str
    detail: str
    affected: list[str] = field(default_factory=list)
    count: int = 0


@dataclass
class SkipBreakdown:
    reason_code: str
    count: int
    pct: float
    examples: list[str]
    description: str


@dataclass
class HarvestAnalysis:
    """Complete analysis result — passed to ReportWriter."""
    run_id: str
    start_time: str
    end_time: str
    duration_s: float
    duration_human: str
    config_summary: dict
    findings: list[Finding]
    skip_breakdown: list[SkipBreakdown]
    http_summary: dict
    log_summary: dict
    data_summary: dict
    per_server_summary: dict
    # Raw error log lines (ERROR + CRITICAL) included verbatim in the report
    error_log_lines: list[str]


# ─── Skip reason descriptions ──────────────────────────────────────────────────

_SKIP_DESCRIPTIONS = {
    CDM_DATA_TYPE_UNSUPPORTED: (
        "CDM type is not TimeSeries/Profile/TimeSeriesProfile (expected; these datasets "
        "are never applicable to CDE)"
    ),
    HTTP_ERROR:               "HTTP error fetching dataset metadata from ERDDAP",
    MISSING_REQUIRED_VARS:    "Missing at least one LLAT variable (time, latitude, longitude)",
    NO_SUPPORTED_VARIABLES:   "No CF standard names map to a CDE Essential Ocean Variable",
    INGEST_FLAG_FALSE:        "ERDDAP admin set cde_ingest=False on this dataset",
    DEPTH_AND_ALTITUDE:       "Dataset has both depth and altitude variables (ambiguous vertical axis)",
    UNKNOWN_ERROR:            "An unhandled exception occurred during dataset processing",
}


# ─── Entry point ──────────────────────────────────────────────────────────────

def analyze(artifacts) -> HarvestAnalysis:
    """Analyze HarvestArtifacts and return a complete HarvestAnalysis."""
    findings: list[Finding] = []

    findings += _check_fatal_error(artifacts)
    findings += _check_server_reachability(artifacts)
    findings += _check_unknown_errors(artifacts)
    findings += _check_http_errors(artifacts)
    findings += _check_data_integrity(artifacts)
    findings += _check_unhandled_patterns(artifacts)
    findings += _check_performance(artifacts)
    findings += _check_output_completeness(artifacts)

    findings.sort(key=lambda f: _SEVERITY_RANK.get(f.severity, 99))

    return HarvestAnalysis(
        run_id=artifacts.run_id,
        start_time=artifacts.start_time.isoformat(),
        end_time=artifacts.end_time.isoformat(),
        duration_s=artifacts.duration_s,
        duration_human=artifacts.duration_human,
        config_summary=_config_summary(artifacts.config),
        findings=findings,
        skip_breakdown=_skip_breakdown(artifacts.skipped),
        http_summary=_http_summary(artifacts.http_tracker),
        log_summary=_log_summary(artifacts.log_capture),
        data_summary=_data_summary(artifacts),
        per_server_summary=_per_server_summary(artifacts),
        error_log_lines=_error_log_lines(artifacts.log_capture),
    )


# ─── Individual checks ────────────────────────────────────────────────────────

def _check_fatal_error(a) -> list[Finding]:
    if not a.fatal_error:
        return []
    return [Finding(
        severity=CRITICAL,
        category="Fatal Error",
        title="Harvest terminated with an unhandled top-level exception",
        detail=a.fatal_error,
        count=1,
    )]


def _check_server_reachability(a) -> list[Finding]:
    """Flag any server where every single HTTP call failed."""
    findings = []
    by_server: dict[str, list] = {}
    for call in a.http_tracker.calls:
        by_server.setdefault(call.server, []).append(call)

    for server, calls in by_server.items():
        if calls and all(not c.ok for c in calls):
            first_err = calls[0].error or f"HTTP {calls[0].status}"
            findings.append(Finding(
                severity=CRITICAL,
                category="Server Unreachable",
                title=f"All {len(calls)} request(s) to {server} failed",
                detail=f"First error: {first_err}. Server may be down or URL incorrect.",
                affected=[server],
                count=len(calls),
            ))
    return findings


def _check_unknown_errors(a) -> list[Finding]:
    """Datasets that raised unexpected exceptions (UNKNOWN_ERROR reason code)."""
    if a.skipped.empty:
        return []
    unknown = a.skipped[a.skipped["reason_code"] == UNKNOWN_ERROR]
    if unknown.empty:
        return []

    # Count log entries that include stack traces
    traces = [r for r in a.log_capture.errors if r.exc_info]
    examples = unknown["dataset_id"].head(5).tolist()

    return [Finding(
        severity=HIGH,
        category="Unhandled Exception",
        title=f"{len(unknown)} dataset(s) failed with an unexpected exception",
        detail=(
            f"These datasets raised exceptions not caught by the expected error handlers. "
            f"Stack traces captured in log: {len(traces)}. "
            f"See 'Error Log Entries' section for details."
        ),
        affected=examples,
        count=len(unknown),
    )]


def _check_http_errors(a) -> list[Finding]:
    """Group HTTP failures by status code and emit one finding per group."""
    findings = []
    by_status: dict[str, list] = {}
    for call in a.http_tracker.calls:
        if not call.ok:
            key = str(call.status) if call.status else "connection_error"
            by_status.setdefault(key, []).append(call)

    for status, calls in sorted(by_status.items()):
        severity = HIGH if (status.startswith("5") or status == "connection_error") else MEDIUM
        sample = [c.url[:100] for c in calls[:3]]
        findings.append(Finding(
            severity=severity,
            category="HTTP Error",
            title=f"{len(calls)} HTTP request(s) returned status {status}",
            detail="First affected URLs:\n  " + "\n  ".join(sample),
            affected=[c.url for c in calls],
            count=len(calls),
        ))
    return findings


def _check_data_integrity(a) -> list[Finding]:
    """Inspect the output DataFrames for integrity violations."""
    findings = []

    # ── Profiles DataFrame ──────────────────────────────────────────────────

    if not a.profiles.empty:
        # time_min > time_max (inverted range)
        for col_pair in [("time_min", "time_max")]:
            t_min_col, t_max_col = col_pair
            if t_min_col in a.profiles.columns and t_max_col in a.profiles.columns:
                try:
                    t_min = pd.to_datetime(a.profiles[t_min_col], errors="coerce")
                    t_max = pd.to_datetime(a.profiles[t_max_col], errors="coerce")
                    inverted = a.profiles[t_min > t_max]
                    if not inverted.empty:
                        findings.append(Finding(
                            severity=HIGH,
                            category="Data Integrity",
                            title=f"{len(inverted)} profile(s) have time_min > time_max",
                            detail="Inverted time ranges indicate a parsing or source-data error.",
                            affected=_unique_list(inverted, "dataset_id"),
                            count=len(inverted),
                        ))
                except Exception:
                    pass

        # depth_min > depth_max
        if "depth_min" in a.profiles.columns and "depth_max" in a.profiles.columns:
            bad_depth = a.profiles[
                pd.to_numeric(a.profiles["depth_min"], errors="coerce") >
                pd.to_numeric(a.profiles["depth_max"], errors="coerce")
            ]
            if not bad_depth.empty:
                findings.append(Finding(
                    severity=MEDIUM,
                    category="Data Integrity",
                    title=f"{len(bad_depth)} profile(s) have depth_min > depth_max",
                    detail="Inverted depth ranges may indicate altitude variables were incorrectly handled.",
                    affected=_unique_list(bad_depth, "dataset_id"),
                    count=len(bad_depth),
                ))

        # Null in mandatory columns
        for col in ("latitude", "longitude", "dataset_id", "erddap_url"):
            if col in a.profiles.columns:
                null_count = int(a.profiles[col].isna().sum())
                if null_count:
                    findings.append(Finding(
                        severity=HIGH,
                        category="Data Integrity",
                        title=f"{null_count} profile row(s) have null '{col}'",
                        detail=f"'{col}' should never be null in harvested profile output.",
                        count=null_count,
                    ))

        # n_records <= 0
        if "n_records" in a.profiles.columns:
            bad_records = a.profiles[
                pd.to_numeric(a.profiles["n_records"], errors="coerce").fillna(0) <= 0
            ]
            if not bad_records.empty:
                findings.append(Finding(
                    severity=MEDIUM,
                    category="Data Integrity",
                    title=f"{len(bad_records)} profile(s) have n_records ≤ 0",
                    detail="Zero or negative record counts may indicate a counting failure.",
                    affected=_unique_list(bad_records, "dataset_id"),
                    count=len(bad_records),
                ))

    # ── Datasets DataFrame ──────────────────────────────────────────────────

    if not a.datasets.empty:
        # Duplicate dataset_id rows (caused by EDDTableFromErddap redirects)
        if "dataset_id" in a.datasets.columns:
            dupes = a.datasets[a.datasets.duplicated("dataset_id", keep=False)]
            if not dupes.empty:
                findings.append(Finding(
                    severity=MEDIUM,
                    category="Data Integrity",
                    title=f"{len(dupes)} duplicate dataset_id rows in datasets output",
                    detail=(
                        "Caused by EDDTableFromErddap server-to-server redirects. "
                        "drop_duplicates() in __main__.py handles this before CSV write."
                    ),
                    affected=dupes["dataset_id"].unique().tolist()[:10],
                    count=len(dupes),
                ))

        # Datasets with empty eovs list
        if "eovs" in a.datasets.columns:
            empty_eovs = a.datasets[
                a.datasets["eovs"].apply(
                    lambda v: isinstance(v, list) and len(v) == 0
                )
            ]
            if not empty_eovs.empty:
                findings.append(Finding(
                    severity=MEDIUM,
                    category="Data Integrity",
                    title=f"{len(empty_eovs)} harvested dataset(s) have an empty eovs list",
                    detail=(
                        "A dataset that passed compliance should always have ≥1 EOV. "
                        "This may indicate a race condition or partial metadata fetch."
                    ),
                    affected=_unique_list(empty_eovs, "dataset_id"),
                    count=len(empty_eovs),
                ))

    return findings


def _check_unhandled_patterns(a) -> list[Finding]:
    """
    Scan log messages for patterns that indicate known bugs, edge cases,
    or code-level error conditions that were gracefully absorbed but should
    be surfaced in the validation report.
    """
    findings = []
    logs = a.log_capture

    # ── Profiles removed by bad-geometry filter ───────────────────────────
    bad_geom = logs.search("bad lat/lon") + logs.search("bad geom") + logs.search("removed")
    bad_geom_msgs = [r for r in bad_geom if r.level in ("WARNING", "ERROR")]
    if bad_geom_msgs:
        findings.append(Finding(
            severity=MEDIUM,
            category="Data Quality",
            title=f"Bad-geometry filter removed profiles in {len(bad_geom_msgs)} log event(s)",
            detail=(
                "Profiles with lat/lon outside ±90/±180, depth > 15,000m, or null "
                "records_per_day were discarded. Investigate source data on affected servers."
            ),
            count=len(bad_geom_msgs),
        ))

    # ── Datasets with no profiles after extraction ────────────────────────
    no_profiles = [r for r in logs.warnings if "no profiles found" in r.message.lower()]
    if no_profiles:
        findings.append(Finding(
            severity=MEDIUM,
            category="Data Quality",
            title=f"{len(no_profiles)} compliant dataset(s) produced zero profiles",
            detail=(
                "These datasets passed compliance checks but the profile query returned "
                "nothing. Possible causes: empty ERDDAP dataset, distinct() query timeout, "
                "or all profiles filtered by bad-geometry rule."
            ),
            count=len(no_profiles),
        ))

    # ── OrderByCount unavailable (old ERDDAP version) ────────────────────
    orderby = [r for r in logs.errors if "OrderByCount not available" in r.message]
    if orderby:
        affected = list({r.logger for r in orderby})
        findings.append(Finding(
            severity=MEDIUM,
            category="Compatibility",
            title=f"orderByCount unsupported on {len(orderby)} endpoint(s)",
            detail=(
                "Older ERDDAP versions do not support orderByCount. "
                "Affected datasets will have missing record counts (n_records=null)."
            ),
            affected=affected,
            count=len(orderby),
        ))

    # ── Response size limit hit ───────────────────────────────────────────
    too_big = (
        logs.search("response too big") +
        logs.search("too much data") +
        logs.search("requesting too much")
    )
    too_big = [r for r in too_big if r.level in ("ERROR", "WARNING")]
    if too_big:
        findings.append(Finding(
            severity=MEDIUM,
            category="Size Limit",
            title=f"{len(too_big)} request(s) hit the 200 MB response size cap",
            detail=(
                "ERDDAP returned a response exceeding MAX_RESPONSE_SIZE (200 MB). "
                "Affected datasets were skipped. Consider filtering by time range or "
                "adding them to skipped_datasets.json."
            ),
            count=len(too_big),
        ))

    # ── Non-unique lat/lon within a profile ──────────────────────────────
    non_unique = [r for r in logs.warnings if "non unique lat/lon" in r.message.lower()]
    if non_unique:
        findings.append(Finding(
            severity=LOW,
            category="Data Quality",
            title=f"{len(non_unique)} dataset(s) have profiles with non-unique lat/lon",
            detail=(
                "A single profile ID resolves to multiple locations. "
                "The duplicate is dropped (drop_duplicates on profile_variable_list). "
                "May indicate incorrect metadata on the source ERDDAP server."
            ),
            count=len(non_unique),
        ))

    # ── Unsupported CF standard names (coverage gap) ─────────────────────
    uncovered_cf = [r for r in logs.warnings if "standard_names that CDE doesnt support" in r.message]
    if uncovered_cf:
        for rec in uncovered_cf[:3]:  # cap at 3 findings to avoid noise
            findings.append(Finding(
                severity=INFO,
                category="Coverage Gap",
                title="Harvested data contains CF standard names with no CDE EOV mapping",
                detail=(
                    f"These valid CF names exist in the data but are not mapped to any "
                    f"CDE Essential Ocean Variable: {rec.message[:200]}"
                ),
                count=1,
            ))

    # ── Record count HTTP errors (partial data) ───────────────────────────
    count_errs = [r for r in logs.errors if "HTTP ERROR during count" in r.message]
    if count_errs:
        findings.append(Finding(
            severity=LOW,
            category="Partial Data",
            title=f"{len(count_errs)} dataset(s) have missing record counts",
            detail=(
                "The orderByCount query failed for these datasets. "
                "n_records will be null, and records_per_day will not be calculable."
            ),
            count=len(count_errs),
        ))

    # ── Platform vocabulary failures ──────────────────────────────────────
    plat_errs = [
        r for r in logs.errors
        if "unsupported" in r.message.lower() and "platform" in r.message.lower()
    ]
    if plat_errs:
        findings.append(Finding(
            severity=LOW,
            category="Vocabulary",
            title=f"{len(plat_errs)} dataset(s) have unrecognised platform codes",
            detail=(
                "Platform codes not found in the IOOS/L06 vocabulary mapping. "
                "These datasets will have platform='unknown' in the output."
            ),
            count=len(plat_errs),
        ))

    # ── Error counting with time_coverage_resolution ─────────────────────
    tcr_logs = [r for r in logs.records if "time_coverage_resolution" in r.message]
    invalid_tcr = [r for r in tcr_logs if "invalid" in r.message.lower() or r.level == "ERROR"]
    if invalid_tcr:
        findings.append(Finding(
            severity=LOW,
            category="Data Quality",
            title=f"{len(invalid_tcr)} dataset(s) have an invalid time_coverage_resolution",
            detail=(
                "The global attribute time_coverage_resolution could not be parsed as a "
                "pandas Timedelta. Falling back to sample-based record counting."
            ),
            count=len(invalid_tcr),
        ))

    return findings


def _check_performance(a) -> list[Finding]:
    """Flag unusually slow HTTP requests that may indicate flaky servers."""
    SLOW_THRESHOLD_S = 30.0
    findings = []

    slow = [c for c in a.http_tracker.calls if c.elapsed_s > SLOW_THRESHOLD_S]
    if slow:
        top5 = sorted(slow, key=lambda c: c.elapsed_s, reverse=True)[:5]
        detail_lines = [f"  {c.elapsed_s:.1f}s — {c.url[:100]}" for c in top5]
        findings.append(Finding(
            severity=LOW,
            category="Performance",
            title=f"{len(slow)} HTTP request(s) exceeded {SLOW_THRESHOLD_S:.0f}s",
            detail="Slowest (top 5):\n" + "\n".join(detail_lines),
            count=len(slow),
        ))

    # Single call approaching or exceeding the 200 MB size cap
    SIZE_WARN_BYTES = 150 * 1024 * 1024  # 150 MB
    large = [c for c in a.http_tracker.calls if c.size_bytes >= SIZE_WARN_BYTES]
    if large:
        top3 = sorted(large, key=lambda c: c.size_bytes, reverse=True)[:3]
        detail_lines = [f"  {c.size_bytes / 1024 / 1024:.1f} MB — {c.url[:100]}" for c in top3]
        findings.append(Finding(
            severity=LOW,
            category="Performance",
            title=f"{len(large)} response(s) exceeded 150 MB (approaching the 200 MB cap)",
            detail="Largest responses:\n" + "\n".join(detail_lines),
            count=len(large),
        ))

    return findings


def _check_output_completeness(a) -> list[Finding]:
    findings = []
    if a.datasets.empty and not a.fatal_error:
        findings.append(Finding(
            severity=CRITICAL,
            category="Empty Output",
            title="No datasets were harvested — output is completely empty",
            detail=(
                "datasets DataFrame is empty despite no fatal error. "
                "Possible causes: all servers unreachable, all datasets skipped, "
                "or misconfigured erddap_urls in config."
            ),
        ))
    elif not a.datasets.empty and a.profiles.empty:
        findings.append(Finding(
            severity=HIGH,
            category="Empty Output",
            title="Datasets were found but no profiles were extracted",
            detail=(
                "Every compliant dataset produced zero profiles. "
                "Profile extraction (get_profiles) may be failing silently."
            ),
        ))
    return findings


# ─── Summary builders ─────────────────────────────────────────────────────────

def _skip_breakdown(skipped: pd.DataFrame) -> list[SkipBreakdown]:
    if skipped.empty:
        return []
    total = len(skipped)
    grouped = skipped.groupby("reason_code")["dataset_id"].apply(list)
    result = []
    for reason, ids in grouped.items():
        result.append(SkipBreakdown(
            reason_code=reason,
            count=len(ids),
            pct=round(100 * len(ids) / total, 1) if total else 0,
            examples=ids[:5],
            description=_SKIP_DESCRIPTIONS.get(reason, reason),
        ))
    return sorted(result, key=lambda s: s.count, reverse=True)


def _http_summary(tracker) -> dict:
    calls = tracker.calls
    if not calls:
        return {"total": 0, "success": 0, "errors": 0, "redirects": 0}
    ok = [c for c in calls if c.ok]
    errors = [c for c in calls if not c.ok]
    times = [c.elapsed_s for c in calls]
    redirects = [c for c in calls if c.redirected_to]
    return {
        "total": len(calls),
        "success": len(ok),
        "errors": len(errors),
        "redirects": len(redirects),
        "avg_elapsed_s": round(sum(times) / len(times), 2),
        "max_elapsed_s": round(max(times), 2),
        "total_mb": round(sum(c.size_bytes for c in calls) / 1024 / 1024, 1),
        "errors_by_status": _group_counts(errors, lambda c: str(c.status or "connection_error")),
        "servers_contacted": tracker.unique_servers(),
    }


def _log_summary(capture) -> dict:
    counts = capture.level_counts()
    for lvl in ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"):
        counts.setdefault(lvl, 0)
    return counts


def _data_summary(a) -> dict:
    unique_servers = 0
    if not a.datasets.empty and "erddap_url" in a.datasets.columns:
        unique_servers = int(a.datasets["erddap_url"].nunique())
    return {
        "servers_configured": len(a.config.get("erddap_urls") or []),
        "servers_with_results": len(a.per_server),
        "datasets_harvested": len(a.datasets),
        "datasets_skipped": len(a.skipped),
        "datasets_total": len(a.datasets) + len(a.skipped),
        "profiles_extracted": len(a.profiles),
        "unique_erddap_servers_in_output": unique_servers,
    }


def _per_server_summary(a) -> dict:
    summary: dict = {}
    for url, parts in a.per_server.items():
        profiles_df, datasets_df, _, skipped_df = parts
        summary[url] = {
            "datasets_harvested": len(datasets_df),
            "datasets_skipped": len(skipped_df),
            "profiles_extracted": len(profiles_df),
        }
    return summary


def _config_summary(config: dict) -> dict:
    return {
        "erddap_server_count": len(config.get("erddap_urls") or []),
        "erddap_urls": config.get("erddap_urls") or [],
        "dataset_id_filter": config.get("dataset_ids") or [],
        "cache_enabled": bool(config.get("cache", False)),
        "max_workers": config.get("max-workers", 1),
    }


def _error_log_lines(capture) -> list[str]:
    lines = []
    for r in capture.errors:
        line = f"[{r.time}] {r.level:8s} | {r.logger} | {r.message}"
        lines.append(line)
        if r.exc_info:
            for tb_line in r.exc_info.splitlines():
                lines.append(f"    {tb_line}")
    return lines


# ─── Utilities ────────────────────────────────────────────────────────────────

def _unique_list(df: pd.DataFrame, col: str, limit: int = 10) -> list[str]:
    if col not in df.columns:
        return []
    return df[col].dropna().unique().tolist()[:limit]


def _group_counts(items, key_fn) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in items:
        k = key_fn(item)
        counts[k] = counts.get(k, 0) + 1
    return counts
