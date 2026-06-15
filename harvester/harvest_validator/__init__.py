"""
harvest_validator — run-time validation tool for the CIOOS harvester pipeline.

Instruments a live harvest run, captures every log message, HTTP call, and
data-transformation event, then produces a per-run report that surfaces:
  • Failures and error conditions at each pipeline stage
  • Data-quality issues in the produced DataFrames
  • Unhandled exception patterns and known code-level bugs
  • Performance anomalies (slow servers, oversized responses)
  • Skip-analysis breakdown by reason code
  • HTTP API call statistics

Usage:
    python -m harvest_validator -f harvest_config.yaml [--output-dir ./reports]
"""

from .runner import HarvestRunner, HarvestArtifacts  # noqa: F401
from .analyzers import analyze, HarvestAnalysis       # noqa: F401
from .reporter import ReportWriter                    # noqa: F401
