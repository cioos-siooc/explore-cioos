"""
quick_check.py — fast smoke-test runner for harvest_validator.

Runs the full validation pipeline against a single ERDDAP server and
optionally a single dataset, then prints the report summary to the
terminal.  A full report is also written to ./validation_reports/.

Usage examples:

  # Offline mock run (no network, verifies tool plumbing only)
  python -m harvest_validator.quick_check

  # Real ERDDAP server (all datasets, capped at a short timeout)
  python -m harvest_validator.quick_check \\
      --erddap https://data.cioospacific.ca/erddap

  # Real ERDDAP server, single known dataset
  python -m harvest_validator.quick_check \\
      --erddap https://data.cioospacific.ca/erddap \\
      --dataset IOS_BOT_Profiles

  # Real server, write report to a custom directory
  python -m harvest_validator.quick_check \\
      --erddap https://catalogue.hakai.org/erddap \\
      --dataset HakaiKCBuoyResearch \\
      --output-dir /tmp/my_reports
"""

from __future__ import annotations

import argparse
import logging
import sys
import tempfile
import textwrap
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

import yaml

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s : %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("quick_check")

# ─── Mock response for the offline/dry-run mode ────────────────────────────

# Minimal ERDDAP CSV responses that the harvester expects.
# The allDatasets response has 2 skip-rows (units + type), then zero data rows
# so no datasets are processed — making the run instant.
_MOCK_ALL_DATASETS_CSV = (
    "datasetID,cdm_data_type,accessible,dataStructure\r\n"
    "(String),(String),(String),(String)\r\n"
    ",,,\r\n"
)


def _make_mock_response(url: str, text: str = _MOCK_ALL_DATASETS_CSV) -> MagicMock:
    r = MagicMock()
    r.status_code = 200
    r.url = url
    r.text = text
    r.content = text.encode()
    return r


def _mock_get(session_self, url: str, **kwargs) -> MagicMock:
    """Intercepts requests.Session.get (patched at class level, so first arg is self)."""
    return _make_mock_response(url)


# ─── CLI ──────────────────────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m harvest_validator.quick_check",
        description="Quick validation smoke-test against a single ERDDAP server.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""\
            If --erddap is omitted the tool runs in OFFLINE mode using mocked
            HTTP responses.  No network calls are made; this verifies that the
            validator itself is correctly installed and operational.

            If --erddap is supplied the tool makes real HTTP calls to that server.
            Use --dataset to restrict to a single known dataset ID for a faster run.
        """),
    )
    p.add_argument(
        "--erddap",
        metavar="URL",
        default=None,
        help="ERDDAP base URL (e.g. https://data.cioospacific.ca/erddap). "
             "Omit for offline mock mode.",
    )
    p.add_argument(
        "--dataset",
        metavar="ID",
        default=None,
        help="Limit harvest to a single dataset ID (faster for spot-checks).",
    )
    p.add_argument(
        "--output-dir",
        metavar="DIR",
        default="./validation_reports",
        help="Base directory for report output (default: ./validation_reports).",
    )
    p.add_argument(
        "--no-cache",
        action="store_true",
        default=False,
        help="Disable disk cache (default: cache enabled when offline, disabled online).",
    )
    return p


# ─── Entry point ──────────────────────────────────────────────────────────────

def main(argv=None) -> int:
    args = build_parser().parse_args(argv)

    offline = args.erddap is None
    run_id = datetime.now().strftime("%Y%m%d_%H%M%S")

    if offline:
        logger.info("Running in OFFLINE mode (mocked HTTP responses, no network calls).")
    else:
        logger.info("Running against ERDDAP server: %s", args.erddap)
        if args.dataset:
            logger.info("Limiting to dataset: %s", args.dataset)

    # ── Build config ──────────────────────────────────────────────────────────
    erddap_url = args.erddap or "https://mock.erddap.local/erddap"
    config: dict = {
        "erddap_urls": [erddap_url],
        "cache": False,  # never cache in quick_check; avoids diskcache side-effects
        "max-workers": 1,
    }
    if args.dataset:
        config["dataset_ids"] = [args.dataset]

    output_dir = Path(args.output_dir)

    # ── Run (with or without mock) ────────────────────────────────────────────
    from harvest_validator.runner import HarvestRunner
    from harvest_validator.analyzers import analyze, CRITICAL, HIGH
    from harvest_validator.reporter import ReportWriter

    runner = HarvestRunner(config, run_id)

    if offline:
        with patch("requests.Session.get", _mock_get):
            artifacts = runner.run()
    else:
        artifacts = runner.run()

    # ── Analyze and report ────────────────────────────────────────────────────
    logger.info(
        "Harvest finished in %s — %d dataset(s), %d profile(s), %d skipped, "
        "%d HTTP call(s)",
        artifacts.duration_human,
        len(artifacts.datasets),
        len(artifacts.profiles),
        len(artifacts.skipped),
        len(artifacts.http_tracker.calls),
    )

    analysis = analyze(artifacts)

    report_dir = output_dir / run_id
    writer = ReportWriter(report_dir)
    try:
        writer.write(analysis, artifacts.log_capture)
        logger.info("Report verified (JSON structure, Markdown sections, JSONL integrity).")
    except ValueError as exc:
        logger.error("REPORT VERIFICATION FAILED: %s", exc)
        return 2

    # ── Terminal summary ───────────────────────────────────────────────────────
    _print_summary(analysis, report_dir, offline)

    critical_count = sum(1 for f in analysis.findings if f.severity == CRITICAL)
    high_count     = sum(1 for f in analysis.findings if f.severity == HIGH)

    return 1 if (critical_count or high_count) else 0


def _print_summary(analysis, report_dir: Path, offline: bool) -> None:
    from harvest_validator.analyzers import CRITICAL, HIGH, MEDIUM, LOW, INFO

    mode = "OFFLINE MOCK" if offline else "LIVE"
    print()
    print("═" * 62)
    print(f"  HARVEST VALIDATION QUICK-CHECK  [{mode}]")
    print(f"  Run ID: {analysis.run_id}")
    print("═" * 62)

    ds = analysis.data_summary
    hs = analysis.http_summary
    print(f"  Servers configured : {ds.get('servers_configured', 0)}")
    print(f"  Datasets harvested : {ds.get('datasets_harvested', 0)}")
    print(f"  Datasets skipped   : {ds.get('datasets_skipped', 0)}")
    print(f"  Profiles extracted : {ds.get('profiles_extracted', 0):,}")
    print(f"  HTTP calls made    : {hs.get('total', 0)}")
    print(f"  Duration           : {analysis.duration_human}")
    print()

    if not analysis.findings:
        print("  ✓ No issues detected.")
    else:
        for sev in (CRITICAL, HIGH, MEDIUM, LOW, INFO):
            bucket = [f for f in analysis.findings if f.severity == sev]
            if not bucket:
                continue
            print(f"  [{sev:8s}] {len(bucket)} finding(s):")
            for f in bucket:
                print(f"    • [{f.category}] {f.title}")
                if f.count:
                    print(f"      count={f.count}" + (f", affected={f.affected[:3]}" if f.affected else ""))

    print()
    print(f"  Full report: {report_dir}/")
    print(f"    report.md    — human-readable Markdown")
    print(f"    report.json  — machine-readable data")
    print(f"    events.jsonl — full log event stream")
    print("═" * 62)
    print()


if __name__ == "__main__":
    sys.exit(main())
