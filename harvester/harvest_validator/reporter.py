"""
ReportWriter — generates per-run validation reports from a HarvestAnalysis.

Three output files are written to a timestamped subdirectory:
  report.md     — human-readable Markdown report for engineers and git tracking
  report.json   — machine-readable structured data for downstream tooling
  events.jsonl  — every captured log record (one JSON object per line)

Report sections
───────────────
  1. Header and executive summary table
  2. Findings — severity-grouped, with detail and affected IDs
  3. Skip analysis — per reason-code breakdown
  4. Per-server breakdown
  5. HTTP API call statistics
  6. Log event counts
  7. Error log entries (verbatim)
"""

from __future__ import annotations

import json
import os
import dataclasses
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Optional

from .analyzers import (
    CRITICAL, HIGH, MEDIUM, LOW, INFO,
    Finding, HarvestAnalysis,
)
from .collectors import CapturedLogRecord

# ─── Severity display ─────────────────────────────────────────────────────────

_SEVERITY_PREFIX = {
    CRITICAL: "### CRITICAL",
    HIGH:     "### HIGH",
    MEDIUM:   "### MEDIUM",
    LOW:      "### LOW",
    INFO:     "### INFO",
}

_SEVERITY_BADGE = {
    CRITICAL: "[CRITICAL]",
    HIGH:     "[HIGH]    ",
    MEDIUM:   "[MEDIUM]  ",
    LOW:      "[LOW]     ",
    INFO:     "[INFO]    ",
}


# ─── Writer ───────────────────────────────────────────────────────────────────

class ReportWriter:
    """
    Writes report.md, report.json, and events.jsonl to `output_dir`.
    """

    def __init__(self, output_dir: str | Path) -> None:
        self.output_dir = Path(output_dir)

    def write(self, analysis: HarvestAnalysis, log_capture) -> Path:
        """
        Write all three output files and return the directory path.
        """
        self.output_dir.mkdir(parents=True, exist_ok=True)

        md_path   = self.output_dir / "report.md"
        json_path = self.output_dir / "report.json"
        jsonl_path = self.output_dir / "events.jsonl"

        md_path.write_text(self._build_markdown(analysis), encoding="utf-8")
        json_content = self._build_json(analysis)
        json_path.write_text(json_content, encoding="utf-8")
        self._write_jsonl(log_capture, jsonl_path)

        # Self-verify: re-parse the written files and assert structural integrity.
        # Any validation error is raised immediately so the caller knows the
        # report is corrupt before the run is considered complete.
        self._verify_json(json_path, json_content, analysis)
        self._verify_markdown(md_path)
        self._verify_jsonl(jsonl_path, log_capture)

        return self.output_dir

    # ── Report self-verification ──────────────────────────────────────────────

    # Top-level keys that must be present in every valid report.json
    _REQUIRED_JSON_KEYS = {
        "run_id", "start_time", "end_time", "duration_s", "duration_human",
        "config_summary", "findings", "skip_breakdown",
        "http_summary", "log_summary", "data_summary",
        "per_server_summary", "error_log_lines",
    }

    # Mandatory data_summary keys
    _REQUIRED_DATA_SUMMARY_KEYS = {
        "servers_configured", "datasets_harvested", "datasets_skipped",
        "profiles_extracted",
    }

    def _verify_json(self, path: Path, raw: str, analysis: HarvestAnalysis) -> None:
        """
        Parse report.json and assert required structure.
        Raises ValueError with a clear description on any violation.
        """
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"report.json is not valid JSON: {exc}") from exc

        missing_keys = self._REQUIRED_JSON_KEYS - set(parsed.keys())
        if missing_keys:
            raise ValueError(f"report.json missing required keys: {missing_keys}")

        data_summary = parsed.get("data_summary", {})
        missing_ds = self._REQUIRED_DATA_SUMMARY_KEYS - set(data_summary.keys())
        if missing_ds:
            raise ValueError(f"report.json data_summary missing keys: {missing_ds}")

        if not isinstance(parsed["findings"], list):
            raise ValueError("report.json 'findings' must be a list")

        if not isinstance(parsed["skip_breakdown"], list):
            raise ValueError("report.json 'skip_breakdown' must be a list")

        # Cross-check: findings count in file must match analysis object
        if len(parsed["findings"]) != len(analysis.findings):
            raise ValueError(
                f"report.json findings count ({len(parsed['findings'])}) "
                f"does not match analysis ({len(analysis.findings)})"
            )

        # Ensure every finding has required fields
        for i, finding in enumerate(parsed["findings"]):
            for field_name in ("severity", "category", "title", "detail"):
                if field_name not in finding:
                    raise ValueError(
                        f"report.json findings[{i}] missing field '{field_name}'"
                    )

    def _verify_markdown(self, path: Path) -> None:
        """Assert that report.md was written and contains the expected section headers."""
        content = path.read_text(encoding="utf-8")
        required_sections = [
            "# Harvest Validation Report",
            "## Executive Summary",
            "## Findings",
        ]
        for section in required_sections:
            if section not in content:
                raise ValueError(
                    f"report.md is missing expected section: '{section}'"
                )

    def _verify_jsonl(self, path: Path, log_capture) -> None:
        """Assert events.jsonl contains one valid JSON object per line."""
        lines = path.read_text(encoding="utf-8").splitlines()
        expected_count = len(log_capture.records)
        if len(lines) != expected_count:
            raise ValueError(
                f"events.jsonl has {len(lines)} lines but {expected_count} log records were captured"
            )
        for i, line in enumerate(lines):
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"events.jsonl line {i+1} is not valid JSON: {exc}") from exc
            for field_name in ("time", "level", "logger", "message"):
                if field_name not in obj:
                    raise ValueError(
                        f"events.jsonl line {i+1} missing field '{field_name}'"
                    )

    # ── Markdown ──────────────────────────────────────────────────────────────

    def _build_markdown(self, a: HarvestAnalysis) -> str:
        parts = [
            self._md_header(a),
            self._md_executive_summary(a),
            self._md_findings(a),
            self._md_skip_breakdown(a),
            self._md_per_server(a),
            self._md_http_summary(a),
            self._md_log_summary(a),
            self._md_error_log(a),
        ]
        return "\n\n".join(p for p in parts if p)

    def _md_header(self, a: HarvestAnalysis) -> str:
        return (
            f"# Harvest Validation Report\n\n"
            f"**Run ID:** `{a.run_id}`  \n"
            f"**Started:** {a.start_time}  \n"
            f"**Ended:**   {a.end_time}  \n"
            f"**Duration:** {a.duration_human}  \n"
            f"**ERDDAP servers configured:** {a.config_summary['erddap_server_count']}  \n"
            f"**Dataset ID filter active:** {'Yes' if a.config_summary['dataset_id_filter'] else 'No'}  \n"
            f"**Cache enabled:** {a.config_summary['cache_enabled']}"
        )

    def _md_executive_summary(self, a: HarvestAnalysis) -> str:
        ds = a.data_summary
        hs = a.http_summary
        total = ds.get("datasets_total", 0)
        harvested = ds.get("datasets_harvested", 0)
        harvest_pct = f"{100 * harvested / total:.1f}%" if total else "N/A"

        severity_counts = _count_by_severity(a.findings)
        finding_summary = "  ".join(
            f"{_SEVERITY_BADGE[sev].strip()}: {severity_counts.get(sev, 0)}"
            for sev in (CRITICAL, HIGH, MEDIUM, LOW, INFO)
        )

        lines = [
            "## Executive Summary",
            "",
            "| Metric | Value |",
            "|--------|-------|",
            f"| Servers configured | {ds.get('servers_configured', 0)} |",
            f"| Servers with results | {ds.get('servers_with_results', 0)} |",
            f"| Datasets discovered | {total} |",
            f"| Datasets harvested | {harvested} ({harvest_pct}) |",
            f"| Datasets skipped | {ds.get('datasets_skipped', 0)} |",
            f"| Profiles extracted | {ds.get('profiles_extracted', 0):,} |",
            f"| HTTP calls | {hs.get('total', 0):,} |",
            f"| HTTP errors | {hs.get('errors', 0)} ({_pct(hs.get('errors', 0), hs.get('total', 0))}) |",
            f"| Run duration | {a.duration_human} |",
            "",
            f"**Findings:** {finding_summary}",
        ]
        return "\n".join(lines)

    def _md_findings(self, a: HarvestAnalysis) -> str:
        if not a.findings:
            return "## Findings\n\nNo issues detected."

        by_severity: dict[str, list[Finding]] = {}
        for f in a.findings:
            by_severity.setdefault(f.severity, []).append(f)

        sections = ["## Findings\n"]
        for sev in (CRITICAL, HIGH, MEDIUM, LOW, INFO):
            bucket = by_severity.get(sev, [])
            prefix = _SEVERITY_PREFIX[sev]
            if not bucket:
                sections.append(f"{prefix} (0)\n\n*(none)*")
                continue
            sections.append(f"{prefix} ({len(bucket)})\n")
            for f in bucket:
                sections.append(f"**[{f.category}]** {f.title}")
                sections.append(f"> {f.detail}")
                if f.affected:
                    shown = f.affected[:5]
                    more = len(f.affected) - len(shown)
                    aff = ", ".join(f"`{x}`" for x in shown)
                    if more:
                        aff += f" *(+{more} more)*"
                    sections.append(f"Affected: {aff}")
                sections.append("")

        return "\n".join(sections)

    def _md_skip_breakdown(self, a: HarvestAnalysis) -> str:
        if not a.skip_breakdown:
            return "## Skip Analysis\n\nNo datasets were skipped."

        total_skipped = sum(s.count for s in a.skip_breakdown)
        rows = [
            "## Skip Analysis",
            "",
            f"Total skipped: **{total_skipped}**",
            "",
            "| Reason Code | Count | % | Description |",
            "|-------------|-------|---|-------------|",
        ]
        for s in a.skip_breakdown:
            rows.append(
                f"| `{s.reason_code}` | {s.count} | {s.pct}% | {s.description} |"
            )

        # Sample affected datasets per reason
        rows += ["", "**Examples per reason:**", ""]
        for s in a.skip_breakdown:
            if s.examples:
                rows.append(f"- `{s.reason_code}`: " + ", ".join(f"`{x}`" for x in s.examples))

        return "\n".join(rows)

    def _md_per_server(self, a: HarvestAnalysis) -> str:
        if not a.per_server_summary:
            return ""

        rows = [
            "## Per-Server Breakdown",
            "",
            "| Server | Datasets Harvested | Datasets Skipped | Profiles Extracted |",
            "|--------|--------------------|------------------|--------------------|",
        ]
        for url, stats in sorted(a.per_server_summary.items()):
            server = _server_label(url)
            rows.append(
                f"| {server} | {stats['datasets_harvested']} "
                f"| {stats['datasets_skipped']} "
                f"| {stats['profiles_extracted']:,} |"
            )
        return "\n".join(rows)

    def _md_http_summary(self, a: HarvestAnalysis) -> str:
        hs = a.http_summary
        if not hs.get("total"):
            return "## HTTP API Calls\n\n*(no calls recorded)*"

        lines = [
            "## HTTP API Calls",
            "",
            f"- **Total:** {hs['total']:,}",
            f"- **Success (200):** {hs['success']:,} ({_pct(hs['success'], hs['total'])})",
            f"- **Errors:** {hs['errors']} ({_pct(hs['errors'], hs['total'])})",
            f"- **Redirects (EDDTableFromErddap):** {hs['redirects']}",
            f"- **Avg response time:** {hs.get('avg_elapsed_s', 0):.2f}s",
            f"- **Max response time:** {hs.get('max_elapsed_s', 0):.2f}s",
            f"- **Total data transferred:** {hs.get('total_mb', 0):.1f} MB",
        ]
        if hs.get("errors_by_status"):
            lines.append("")
            lines.append("**Error breakdown by status:**")
            for status, count in sorted(hs["errors_by_status"].items()):
                lines.append(f"  - HTTP {status}: {count}")

        if hs.get("servers_contacted"):
            lines += ["", "**Servers contacted:**"]
            for srv in hs["servers_contacted"]:
                lines.append(f"  - `{srv}`")

        return "\n".join(lines)

    def _md_log_summary(self, a: HarvestAnalysis) -> str:
        ls = a.log_summary
        lines = [
            "## Log Event Summary",
            "",
            "| Level | Count |",
            "|-------|-------|",
        ]
        for level in ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"):
            lines.append(f"| {level} | {ls.get(level, 0):,} |")
        return "\n".join(lines)

    def _md_error_log(self, a: HarvestAnalysis) -> str:
        if not a.error_log_lines:
            return "## Error Log Entries\n\n*(no ERROR or CRITICAL events)*"

        lines = [
            "## Error Log Entries",
            "",
            "```",
        ]
        lines += a.error_log_lines[:200]  # cap at 200 lines
        if len(a.error_log_lines) > 200:
            lines.append(f"... ({len(a.error_log_lines) - 200} more lines truncated — see events.jsonl)")
        lines.append("```")
        return "\n".join(lines)

    # ── JSON ──────────────────────────────────────────────────────────────────

    def _build_json(self, a: HarvestAnalysis) -> str:
        def _to_serialisable(obj):
            if dataclasses.is_dataclass(obj):
                return asdict(obj)
            raise TypeError(f"Not serialisable: {type(obj)}")

        return json.dumps(asdict(a), indent=2, default=str)

    # ── JSONL event log ───────────────────────────────────────────────────────

    def _write_jsonl(self, log_capture, path: Path) -> None:
        with path.open("w", encoding="utf-8") as fh:
            for r in log_capture.records:
                fh.write(json.dumps(asdict(r)) + "\n")


# ─── Utilities ────────────────────────────────────────────────────────────────

def _pct(part: int, total: int) -> str:
    if not total:
        return "N/A"
    return f"{100 * part / total:.1f}%"


def _count_by_severity(findings: list[Finding]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for f in findings:
        counts[f.severity] = counts.get(f.severity, 0) + 1
    return counts


def _server_label(url: str) -> str:
    """Extract the hostname from an ERDDAP URL for compact table display."""
    from urllib.parse import urlparse
    parsed = urlparse(url)
    return parsed.netloc or url[:60]
