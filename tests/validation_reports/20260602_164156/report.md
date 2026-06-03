# Harvest Validation Report

**Run ID:** `20260602_164156`  
**Started:** 2026-06-02T16:41:56.188043  
**Ended:**   2026-06-02T16:41:56.336321  
**Duration:** 0s  
**ERDDAP servers configured:** 1  
**Dataset ID filter active:** No  
**Cache enabled:** True

## Executive Summary

| Metric | Value |
|--------|-------|
| Servers configured | 1 |
| Servers with results | 0 |
| Datasets discovered | 0 |
| Datasets harvested | 0 (N/A) |
| Datasets skipped | 0 |
| Profiles extracted | 0 |
| HTTP calls | 1 |
| HTTP errors | 1 (100.0%) |
| Run duration | 0s |

**Findings:** [CRITICAL]: 2  [HIGH]: 1  [MEDIUM]: 0  [LOW]: 0  [INFO]: 0

## Findings

### CRITICAL (2)

**[Server Unreachable]** All 1 request(s) to mock.erddap.local failed
> First error: _mock_get() takes 1 positional argument but 2 were given. Server may be down or URL incorrect.
Affected: `mock.erddap.local`

**[Empty Output]** No datasets were harvested — output is completely empty
> datasets DataFrame is empty despite no fatal error. Possible causes: all servers unreachable, all datasets skipped, or misconfigured erddap_urls in config.

### HIGH (1)

**[HTTP Error]** 1 HTTP request(s) returned status connection_error
> First affected URLs:
  https://mock.erddap.local/erddap/tabledap/allDatasets.csv?&accessible="public"&dataStructure="table"
Affected: `https://mock.erddap.local/erddap/tabledap/allDatasets.csv?&accessible="public"&dataStructure="table"`

### MEDIUM (0)

*(none)*
### LOW (0)

*(none)*
### INFO (0)

*(none)*

## Skip Analysis

No datasets were skipped.

## HTTP API Calls

- **Total:** 1
- **Success (200):** 0 (0.0%)
- **Errors:** 1 (100.0%)
- **Redirects (EDDTableFromErddap):** 0
- **Avg response time:** 0.00s
- **Max response time:** 0.00s
- **Total data transferred:** 0.0 MB

**Error breakdown by status:**
  - HTTP connection_error: 1

**Servers contacted:**
  - `mock.erddap.local`

## Log Event Summary

| Level | Count |
|-------|-------|
| DEBUG | 0 |
| INFO | 3 |
| WARNING | 0 |
| ERROR | 0 |
| CRITICAL | 0 |

## Error Log Entries

*(no ERROR or CRITICAL events)*