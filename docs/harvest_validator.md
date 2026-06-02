# Harvest Validator

A run-time validation tool that instruments a live harvest, captures every log message, HTTP call, and data-transformation event, then produces a per-run report surfacing failures, data-quality issues, unhandled error conditions, and performance anomalies.

---

## Directory Structure

```
harvester/harvest_validator/
├── __init__.py       Exports HarvestRunner, analyze, ReportWriter
├── __main__.py       Full CLI  (python -m harvest_validator -f config.yaml)
├── collectors.py     LogCapture (logging handler) + HttpCallTracker (HTTP interceptor)
├── runner.py         HarvestRunner orchestrator + HarvestArtifacts data class
├── analyzers.py      17 check functions → HarvestAnalysis with ranked findings
├── reporter.py       ReportWriter: writes report.md / report.json / events.jsonl
└── quick_check.py    Fast smoke-test runner with optional ERDDAP + dataset args
```

---

## Usage

### Quick check — offline (no network, verifies the tool itself is healthy)

```bash
python -m harvest_validator.quick_check
```

### Quick check — real ERDDAP server, all datasets

```bash
python -m harvest_validator.quick_check \
    --erddap https://data.cioospacific.ca/erddap
```

### Quick check — single dataset (fastest spot-check)

```bash
python -m harvest_validator.quick_check \
    --erddap https://catalogue.hakai.org/erddap \
    --dataset HakaiKCBuoyResearch
```

### Full production run via the main CLI

```bash
# Reads erddap_urls from the config file, runs all servers
python -m harvest_validator -f harvest_config.yaml

# Write reports to a custom directory
python -m harvest_validator -f harvest_config.yaml --output-dir /data/reports

# Override the auto-generated run ID
python -m harvest_validator -f harvest_config.yaml --run-id nightly_20260602
```

### CLI options

| Option | Default | Description |
|--------|---------|-------------|
| `-f / --file` | *(required)* | Path to `harvest_config.yaml` |
| `--output-dir` | `./validation_reports` | Base directory for report output |
| `--run-id` | `YYYYMMDD_HHMMSS` | Override the auto-generated run ID |
| `--format` | `all` | `all` writes all three files; `md` or `json` for one only |

### `quick_check.py` options

| Option | Default | Description |
|--------|---------|-------------|
| `--erddap` | *(offline mock)* | ERDDAP base URL to validate against |
| `--dataset` | *(all datasets)* | Limit to one dataset ID for a faster spot-check |
| `--output-dir` | `./validation_reports` | Base directory for report output |
| `--no-cache` | `False` | Disable disk cache during the run |

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | Run completed; no CRITICAL or HIGH findings detected |
| `1` | Run completed; at least one CRITICAL or HIGH finding detected |
| `2` | Tool itself failed (bad config, verification error, import error) |

---

## What the Tool Captures

Both collectors are context managers. They install themselves before the harvest starts and restore original state afterwards, making them transparent to the source code under observation.

### `LogCapture` — `collectors.py`

**Mechanism:** Installs as a root-level `logging.Handler` at `DEBUG` level.

**Captures per event:**

| Field | Description |
|-------|-------------|
| `time` | ISO 8601 timestamp |
| `level` | `DEBUG` / `INFO` / `WARNING` / `ERROR` / `CRITICAL` |
| `logger` | Logger name (usually the ERDDAP domain or module path) |
| `message` | Formatted log message |
| `exc_info` | Full stack trace if an exception was attached |

All records are written to `events.jsonl` (one JSON object per line) and used by the analyzer to detect patterns in warnings and errors.

### `HttpCallTracker` — `collectors.py`

**Mechanism:** Monkey-patches `requests.Session.get` at the class level. Thread-safe via a lock; the harvester runs worker threads concurrently.

**Captures per call:**

| Field | Description |
|-------|-------------|
| `url` | Full request URL |
| `server` | Hostname extracted from the URL |
| `status` | HTTP status code; `None` if a connection-level error occurred |
| `elapsed_s` | Wall-clock time from request start to response receipt |
| `size_bytes` | Length of the response body in bytes |
| `ok` | `True` only when `status == 200` |
| `redirected_to` | Destination URL if the server redirected (EDDTableFromErddap) |
| `error` | Exception message when no HTTP response was received |

---

## Analyzer Detection

The analyzer (`analyzers.py`) runs 17 check functions against the collected artifacts. Every finding has a severity, category, human-readable title, detail text, and an optional list of affected dataset or server IDs.

### Severity levels

| Severity | Meaning | Exit code impact |
|----------|---------|-----------------|
| `CRITICAL` | Pipeline is broken or output is entirely unusable | exit 1 |
| `HIGH` | Significant data loss or unhandled exceptions | exit 1 |
| `MEDIUM` | Partial data loss or known compatibility gaps | exit 0 |
| `LOW` | Minor quality warnings or vocabulary mismatches | exit 0 |
| `INFO` | Coverage gaps and informational observations | exit 0 |

### Finding categories

| Category | Severity | Trigger condition |
|----------|----------|-------------------|
| **Fatal Error** | CRITICAL | A top-level unhandled exception terminated the harvest loop |
| **Server Unreachable** | CRITICAL | Every HTTP call to an ERDDAP server failed |
| **Empty Output** | CRITICAL | No datasets harvested despite no fatal error |
| **Empty Output** | HIGH | Datasets found but zero profiles extracted |
| **Unhandled Exception** | HIGH | Datasets with `UNKNOWN_ERROR` reason code; stack traces in log |
| **HTTP Error** | HIGH | HTTP 5xx responses or connection errors |
| **HTTP Error** | MEDIUM | HTTP 4xx responses |
| **Data Integrity** | HIGH | `time_min > time_max` in profiles; null mandatory columns |
| **Data Integrity** | MEDIUM | `depth_min > depth_max`; duplicate `dataset_id` rows; empty `eovs` list on harvested datasets; `n_records ≤ 0` |
| **Compatibility** | MEDIUM | `orderByCount` unsupported on older ERDDAP server versions (record counts will be null) |
| **Size Limit** | MEDIUM | Response at or over the 200 MB cap; dataset skipped |
| **Data Quality** | MEDIUM | Bad-geometry filter removed profiles (lat/lon out of range, depth > 15,000 m) |
| **Data Quality** | MEDIUM | Compliant datasets produced zero profiles after extraction |
| **Data Quality** | LOW | Profiles with non-unique lat/lon for the same profile ID |
| **Partial Data** | LOW | `orderByCount` HTTP errors; `n_records` will be null for affected datasets |
| **Vocabulary** | LOW | IOOS or L06 platform codes not found in the vocabulary mapping |
| **Performance** | LOW | HTTP requests exceeding 30 s; responses exceeding 150 MB |
| **Coverage Gap** | INFO | CF standard names present in the data but unmapped to any CDE EOV |

### Summary objects included alongside findings

In addition to the ranked findings list, the analysis includes:

- **`skip_breakdown`** — per reason-code breakdown: count, percentage of total skipped, up to 5 example dataset IDs, and a plain-English description of the reason
- **`http_summary`** — total calls, success/error counts, average and max response time, total MB transferred, error breakdown by HTTP status, list of servers contacted
- **`log_summary`** — count of events at each level (DEBUG / INFO / WARNING / ERROR / CRITICAL)
- **`data_summary`** — servers configured, servers with results, datasets harvested/skipped/total, profiles extracted
- **`per_server_summary`** — per ERDDAP URL: datasets harvested, datasets skipped, profiles extracted
- **`error_log_lines`** — verbatim ERROR and CRITICAL log lines (with stack traces) included in the Markdown report

---

## Per-Run Report Output

Each run writes three files to `<output-dir>/<run-id>/`:

```
validation_reports/
└── 20260602_143022/
    ├── report.md      Human-readable Markdown report
    ├── report.json    Machine-readable structured data
    └── events.jsonl   Full log event stream (one JSON object per line)
```

### `report.md` — Markdown sections

| Section | Contents |
|---------|----------|
| Header | Run ID, start/end times, duration, config summary |
| Executive Summary | Metrics table (datasets, profiles, HTTP calls, errors) + finding count by severity |
| Findings | Severity-grouped findings with detail text and affected IDs |
| Skip Analysis | Reason-code breakdown table + example dataset IDs per reason |
| Per-Server Breakdown | Harvested / skipped / profiles per ERDDAP server |
| HTTP API Calls | Call counts, error rate, timing stats, per-status error breakdown, server list |
| Log Event Summary | Record count per log level |
| Error Log Entries | Verbatim ERROR/CRITICAL log lines (capped at 200; remainder in events.jsonl) |

### `report.json` — Required top-level keys

```json
{
  "run_id": "20260602_143022",
  "start_time": "2026-06-02T14:30:22",
  "end_time": "2026-06-02T14:45:54",
  "duration_s": 932.1,
  "duration_human": "15m 32s",
  "config_summary": { "erddap_server_count": 5, "cache_enabled": false, ... },
  "findings": [ { "severity": "HIGH", "category": "...", "title": "...", "detail": "...", "affected": [...], "count": 3 } ],
  "skip_breakdown": [ { "reason_code": "CDM_DATA_TYPE_UNSUPPORTED", "count": 89, "pct": 48.6, "examples": [...], "description": "..." } ],
  "http_summary": { "total": 2542, "success": 2476, "errors": 66, "avg_elapsed_s": 1.23, ... },
  "log_summary": { "DEBUG": 8432, "INFO": 1204, "WARNING": 89, "ERROR": 52, "CRITICAL": 0 },
  "data_summary": { "datasets_harvested": 612, "datasets_skipped": 183, "profiles_extracted": 14203, ... },
  "per_server_summary": { "data.cioospacific.ca": { "datasets_harvested": 120, ... } },
  "error_log_lines": [ "[14:32:15] ERROR | ... | ..." ]
}
```

### `events.jsonl` — Log event stream

One JSON object per line. Each object has: `time`, `level`, `logger`, `message`, `exc_info` (null unless an exception was attached).

```jsonl
{"time": "2026-06-02T14:30:24", "level": "INFO", "logger": "data.cioospacific.ca", "message": "Found 147 datasets", "exc_info": null}
{"time": "2026-06-02T14:32:15", "level": "ERROR", "logger": "data.cioospacific.ca - bad_ds", "message": "HTTP ERROR: 500 Internal Server Error", "exc_info": "Traceback (most recent call last):\n  ..."}
```

### Report self-verification

Before `ReportWriter.write()` returns, it re-reads all three output files and asserts:

- `report.json` parses as valid JSON and contains all required top-level keys
- Every finding object has `severity`, `category`, `title`, and `detail` fields
- `data_summary` contains all required sub-keys
- Finding count in the file matches the in-memory analysis object
- `report.md` contains the required section headers
- `events.jsonl` has exactly as many lines as log records were captured, and every line is valid JSON with `time`, `level`, `logger`, `message` fields

A structural violation raises `ValueError` and the tool exits with code 2, preventing a silently corrupt report from being treated as valid.

---

## Architecture Overview

```
harvest_config.yaml
        │
        ▼
  HarvestRunner.run()           ← runner.py
        │
        ├── LogCapture (enters)        intercepts root logger
        ├── HttpCallTracker (enters)   patches requests.Session.get
        │
        ├── harvest_erddap() × N       real production harvest code
        │       ↓ per server
        │   [profiles_df, datasets_df, variables_df, skipped_df]
        │
        ├── HttpCallTracker (exits)    restores original Session.get
        └── LogCapture (exits)         removes handler
                │
                ▼
        HarvestArtifacts               runner.py
          profiles, datasets,
          variables, skipped,
          log_capture, http_tracker,
          per_server, fatal_error
                │
                ▼
        analyze(artifacts)             analyzers.py
          17 check functions
                │
                ▼
        HarvestAnalysis                analyzers.py
          findings (ranked),
          skip_breakdown,
          http_summary,
          log_summary,
          data_summary
                │
                ▼
        ReportWriter.write()           reporter.py
          report.md
          report.json
          events.jsonl
          + self-verification
```

---

## See Also

- [docs/technical_debt.md](technical_debt.md) — Known bugs and unhandled conditions the validator is designed to surface
- [docs/execution_flow.md](execution_flow.md) — How the harvest pipeline works end-to-end
- [docs/data_flow.md](data_flow.md) — Data transformations the validator monitors
- [docs/tests.md](tests.md) — The separate pytest-based unit and integration test suite
