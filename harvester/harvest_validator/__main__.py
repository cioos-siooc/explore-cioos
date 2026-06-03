"""
harvest_validator — CLI entry point.

Usage:
    python -m harvest_validator -f harvest_config.yaml
    python -m harvest_validator -f harvest_config.yaml --output-dir ./reports
    python -m harvest_validator -f harvest_config.yaml --output-dir ./reports --format json

Options:
    -f / --file        Path to harvest_config.yaml (required)
    --output-dir       Directory to write reports into (default: ./validation_reports)
    --format           Output format: 'all' (default), 'md', or 'json'
    --run-id           Override the auto-generated run ID (YYYYMMDD_HHMMSS)

The tool:
  1. Reads the harvest config
  2. Runs the full harvest_erddap() pipeline with instrumentation active
  3. Analyzes collected artifacts for failures, data quality issues,
     unhandled error conditions, and performance anomalies
  4. Writes a per-run report to <output-dir>/<run-id>/

Exit codes:
    0  — harvest completed; CRITICAL or HIGH findings were NOT detected
    1  — harvest completed; at least one CRITICAL or HIGH finding detected
    2  — tool itself failed (bad config, import error, etc.)
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime
from pathlib import Path

import yaml

from .runner import HarvestRunner
from .analyzers import analyze, CRITICAL, HIGH
from .reporter import ReportWriter


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s : %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("harvest_validator")


# ─── CLI ──────────────────────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m harvest_validator",
        description="Run and validate a CIOOS harvest, producing a per-run report.",
    )
    p.add_argument(
        "-f", "--file",
        required=True,
        metavar="CONFIG",
        help="Path to harvest_config.yaml",
    )
    p.add_argument(
        "--output-dir",
        default="./validation_reports",
        metavar="DIR",
        help="Base directory for report output (default: ./validation_reports)",
    )
    p.add_argument(
        "--run-id",
        default=None,
        metavar="ID",
        help="Override auto-generated run ID (default: YYYYMMDD_HHMMSS)",
    )
    p.add_argument(
        "--format",
        choices=["all", "md", "json"],
        default="all",
        help="Report format: 'all' writes report.md + report.json + events.jsonl (default)",
    )
    return p


# ─── Entry point ──────────────────────────────────────────────────────────────

def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    # ── Load config ───────────────────────────────────────────────────────────
    config_path = Path(args.file)
    if not config_path.exists():
        logger.error("Config file not found: %s", config_path)
        return 2

    try:
        with config_path.open() as fh:
            config: dict = yaml.safe_load(fh) or {}
    except Exception as exc:
        logger.error("Failed to parse config: %s", exc)
        return 2

    if not config.get("erddap_urls"):
        logger.error("Config must contain at least one erddap_urls entry.")
        return 2

    # ── Prepare run ───────────────────────────────────────────────────────────
    run_id = args.run_id or datetime.now().strftime("%Y%m%d_%H%M%S")
    output_dir = Path(args.output_dir) / run_id

    logger.info("=" * 60)
    logger.info("harvest_validator  run_id=%s", run_id)
    logger.info("Config:     %s", config_path)
    logger.info("Output:     %s", output_dir)
    logger.info("Servers:    %d", len(config.get("erddap_urls", [])))
    logger.info("=" * 60)

    # ── Run harvest with instrumentation ──────────────────────────────────────
    logger.info("Starting instrumented harvest run...")
    runner = HarvestRunner(config, run_id)
    artifacts = runner.run()

    logger.info(
        "Harvest complete in %s — %d dataset(s), %d profile(s), %d skipped",
        artifacts.duration_human,
        len(artifacts.datasets),
        len(artifacts.profiles),
        len(artifacts.skipped),
    )

    if artifacts.fatal_error:
        logger.error("FATAL ERROR during harvest:\n%s", artifacts.fatal_error)

    # ── Analyze ───────────────────────────────────────────────────────────────
    logger.info("Analyzing artifacts...")
    analysis = analyze(artifacts)

    critical_count = sum(1 for f in analysis.findings if f.severity == CRITICAL)
    high_count = sum(1 for f in analysis.findings if f.severity == HIGH)
    total_findings = len(analysis.findings)

    logger.info(
        "Analysis complete — %d finding(s): %d CRITICAL, %d HIGH, %d other",
        total_findings,
        critical_count,
        high_count,
        total_findings - critical_count - high_count,
    )

    # ── Write report ──────────────────────────────────────────────────────────
    logger.info("Writing and verifying report to %s ...", output_dir)
    writer = ReportWriter(output_dir)
    try:
        report_dir = writer.write(analysis, artifacts.log_capture)
    except ValueError as exc:
        logger.error("REPORT VERIFICATION FAILED: %s", exc)
        logger.error("The generated report is structurally invalid. Check the output directory.")
        return 2

    logger.info("Report verified and written:")
    logger.info("  %s/report.md     — human-readable summary", report_dir)
    logger.info("  %s/report.json   — machine-readable data", report_dir)
    logger.info("  %s/events.jsonl  — full log event stream", report_dir)

    # ── Print finding summary to stdout ───────────────────────────────────────
    _print_summary(analysis)

    # ── Exit code ─────────────────────────────────────────────────────────────
    if critical_count > 0 or high_count > 0:
        logger.warning(
            "Returning exit code 1: %d CRITICAL and %d HIGH finding(s) detected.",
            critical_count, high_count,
        )
        return 1
    return 0


def _print_summary(analysis) -> None:
    """Print a brief finding summary to stdout after the run."""
    print()
    print("─" * 60)
    print(f"  HARVEST VALIDATION SUMMARY  —  {analysis.run_id}")
    print("─" * 60)
    ds = analysis.data_summary
    print(f"  Datasets harvested : {ds.get('datasets_harvested', 0)}")
    print(f"  Datasets skipped   : {ds.get('datasets_skipped', 0)}")
    print(f"  Profiles extracted : {ds.get('profiles_extracted', 0):,}")
    print(f"  Duration           : {analysis.duration_human}")
    print()

    from .analyzers import CRITICAL, HIGH, MEDIUM, LOW, INFO
    for sev in (CRITICAL, HIGH, MEDIUM, LOW, INFO):
        bucket = [f for f in analysis.findings if f.severity == sev]
        if bucket:
            print(f"  [{sev:8s}] {len(bucket)} finding(s):")
            for f in bucket:
                print(f"    • [{f.category}] {f.title}")
    if not analysis.findings:
        print("  No issues detected.")

    print("─" * 60)
    print()


# ─── Run ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    sys.exit(main())
