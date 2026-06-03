# Test Suite Documentation

## Overview

The test suite lives in `tests/` and covers the harvester ETL pipeline end-to-end: ERDDAP HTTP calls, dataset compliance checking, profile statistics extraction, CSV output, and database loading. All external I/O is mocked — no live ERDDAP, CKAN, or database connections are required.

**133 tests, 0 failures.**

```
tests/
├── pyproject.toml              # uv project; harvester + db-loader as editable installs
├── conftest.py                 # shared fixtures, mock CSV data, ERDDAP response routing
├── unit/                       # 110 tests across 9 modules
│   ├── test_erddap_client.py
│   ├── test_dataset.py
│   ├── test_compliance_checker.py
│   ├── test_profiles.py
│   ├── test_utils.py
│   ├── test_ckan.py
│   ├── test_harvest_erddap.py
│   ├── test_csv_generation.py
│   └── test_db_loader.py
└── integration/                # 23 tests
    └── test_full_pipeline.py
```

---

## Running the Tests

```bash
cd tests/
uv sync                        # first time: install deps into .venv
uv run pytest                  # run everything
uv run pytest unit/            # unit tests only
uv run pytest integration/     # integration test only
uv run pytest -k "compliance"  # by keyword
uv run pytest -v --tb=long     # verbose with full tracebacks
```

---

## Architecture

### Dependency Management

The test project is a standalone uv project with its own `pyproject.toml`. Both `harvester` and `db-loader` are declared as `editable = true` sources, so changes to the source tree are immediately reflected without reinstalling:

```toml
[tool.uv.sources]
harvester = { path = "../harvester", editable = true }
db-loader = { path = "../db-loader", editable = true }
```

### Mocking Strategy

| Layer | Mocking approach |
|-------|-----------------|
| ERDDAP HTTP | `patch("cde_harvester.ERDDAP.requests.Session")` + `MockResponse` fixture |
| CKAN HTTP | `patch("cde_harvester.ckan.create_ckan_erddap_link.requests.get")` |
| Dataset objects | `MagicMock` with all required attributes set explicitly |
| SQLAlchemy engine | `MagicMock` + `engine.begin.return_value.__enter__.return_value = conn` |
| SQL text capture | `patch("cde_db_loader.__main__.text", side_effect=lambda s: ...)` |
| DataFrame writes | `patch("pandas.DataFrame.to_sql")` |
| Sentry SDK | Module-level `_sentry_init_patcher.start()` in conftest — prevents `BadDsn` errors from sentry 2.x when `SENTRY_DSN` is unset |

### conftest.py — Shared Infrastructure

`tests/conftest.py` is the backbone of the test suite. It contains:

**Fixture CSV strings** — static multi-line strings that reproduce exact ERDDAP response formats, including the units rows that `erddap_csv_to_df` skips:

| Constant | Endpoint / Purpose |
|----------|--------------------|
| `ERDDAP_ALL_DATASETS_CSV` | `/tabledap/allDatasets.csv` — `skiprows=[1, 2]` |
| `ERDDAP_INFO_CSV` | `/info/{id}/index.csv` — `skiprows=[]`, valid TimeSeries dataset |
| `ERDDAP_INFO_NO_EOVS_CSV` | Info CSV with unsupported standard names only |
| `ERDDAP_INFO_INGEST_FALSE_CSV` | Info CSV with `cde_ingest=False` global |
| `ERDDAP_INFO_DEPTH_AND_ALTITUDE_CSV` | Info CSV with both `depth` and `altitude` variables |
| `ERDDAP_PROFILE_IDS_CSV` | `?station_id,lat,lon&distinct()` — single station |
| `ERDDAP_PROFILE_IDS_TWO_CSV` | Same query — two stations |
| `ERDDAP_TIME_MINMAX_CSV` | `?orderByMinMax(...)` for time — 2 stations × 2 rows (max/min pairs) |
| `ERDDAP_DEPTH_MINMAX_CSV` | `?orderByMinMax(...)` for depth |
| `ERDDAP_COUNT_CSV` | `?orderByCount(...)` — record counts per station |
| `CKAN_PACKAGE_SEARCH_RESPONSE` | CKAN `/action/package_search` page 1 JSON |
| `CKAN_EMPTY_RESPONSE` | CKAN page 2 (stops pagination) |

**URL router** — `_route_erddap_url(url)` decodes the request URL and dispatches to the right fixture CSV. This is used by `make_mock_session_get`, the `side_effect` function wired to `requests.Session.get` in tests that use the real `ERDDAP` class.

**`build_variables_df()`** — reproduces the exact `df_variables` DataFrame that `Dataset.get_metadata()` builds from the info CSV, so unit tests for `CDEComplianceChecker` and `get_profiles` can receive a realistic object without making HTTP calls.

**`build_mock_dataset()`** — constructs a `MagicMock` with all attributes that `CDEComplianceChecker` and `get_profiles` access: `df_variables`, `variables_list`, `globals`, `eovs`, `profile_variables`, `profile_variable_list`, `get_profile_ids()`, `get_max_min()`, `get_count()`, `get_df()`. It derives EOVs using the real `cde_eov_to_standard_name` mapping so the output is realistic.

### Unit Test Pattern

Each unit test file imports from `conftest` and the module under test. Tests are grouped into classes by scenario:

```python
class TestPassesAllChecks:
    def test_valid_timeseries_dataset_passes(self):
        checker = _checker()          # build from fixture CSV
        assert checker.passes_all_checks() is True

class TestRequiredVariables:
    def test_missing_time_fails(self):
        checker = _checker()
        checker.dataset.variables_list.remove("time")
        assert checker.check_required_variables() is False
        assert checker.failure_reason_code == MISSING_REQUIRED_VARS
```

### Integration Test Pattern

`test_full_pipeline.py` uses `scope="module"` fixtures that chain: each phase consumes the output of the previous phase.

```
harvest_result (module fixture)
  ↓ mocked ERDDAP session + CKAN get
  ↓ real harvest_erddap()
  ↓ produces (profiles, datasets, variables, skipped) DataFrames
  ↓
written_csv_folder (module fixture, depends on harvest_result)
  ↓ real harvester_main() — merges CKAN data, writes CSVs to tmp_path
  ↓ produces datasets.csv, profiles.csv, skipped.csv
  ↓
db_load_calls (module fixture, depends on written_csv_folder)
  ↓ real db_main() with mocked SQLAlchemy engine
  ↓ captures SQL text strings passed to text()
  ↓ returns list of SQL strings for assertion
```

---

## Integration Test Data Flow

The integration test exercises the complete pipeline described in `docs/data_flow.md`:

```
ERDDAP Servers (mocked)          CKAN (mocked)
  │ allDatasets.csv                │ package_search JSON
  │ info/{id}/index.csv            │ (1 page + empty terminator)
  │ distinct() profile IDs         │
  │ orderByMinMax() time/depth     │
  │ orderByCount() records         │
  └─────────────┬──────────────────┘
                │
      harvest_erddap()         ← real code, mocked I/O
      CDEComplianceChecker     ← real code
      get_profiles()           ← real code
                │
                ▼
      (profiles_df, datasets_df, variables_df, skipped_df)
      [tested by TestHarvestOutput — 6 assertions]
                │
                ▼
      harvester_main()         ← real code
        CKAN merge              (title, title_fr, organizations)
        deduplication
        CSV write (tmp_path)
                │
                ▼
      datasets.csv  profiles.csv  skipped.csv  ckan.csv
      [tested by TestCsvFilesWritten — 8 assertions]
                │
                ▼
      db_main()               ← real code, mocked engine
        pd.read_csv()          real parsing of written CSVs
        ast.literal_eval()     real array column parsing
        engine.begin() → conn  mocked context manager
        conn.execute(text(...)) captured via text() patch
                │
                ▼
      SQL call list
      [tested by TestDbLoadPhase — 5 assertions]
```

---

## All Existing Tests

### `unit/test_erddap_client.py` — 14 tests

#### `TestERDDAPInit`
| Test | What it verifies |
|------|-----------------|
| `test_url_is_stored` | `ERDDAP.url` is set from the constructor argument |
| `test_domain_extracted_from_url` | `ERDDAP.domain` extracts the netloc correctly |
| `test_get_all_datasets_returns_dataframe` | `df_all_datasets` is a DataFrame on successful init |
| `test_get_all_datasets_has_expected_columns` | `datasetID` and `cdm_data_type` columns present |
| `test_get_all_datasets_skips_units_rows` | Units row (`"(String)"`) is not present in output |
| `test_empty_response_gives_empty_dataframe` | All-units CSV produces an empty DataFrame |

#### `TestErddapCsvToDf`
| Test | What it verifies |
|------|-----------------|
| `test_200_response_returns_dataframe` | A 200 OK response is parsed into a DataFrame |
| `test_404_returns_empty_dataframe` | HTTP 404 is treated as no-data, returns empty |
| `test_500_no_matching_results_returns_empty` | ERDDAP "no matching results" 500 returns empty |
| `test_500_other_error_raises` | Other 500 errors raise `HTTPError` |
| `test_response_too_large_raises` | Responses exceeding 200 MB raise `RuntimeError` |

#### `TestParseErddapDate`
| Test | What it verifies |
|------|-----------------|
| `test_iso8601_string` | ISO 8601 strings are parsed correctly |
| `test_large_epoch_is_not_timestamp` | Scientific-notation epochs (`"1.5E9"`) are parsed as timestamps |
| `test_invalid_string_returns_nat` | Unparseable strings return `NaT` |

---

### `unit/test_dataset.py` — 15 tests

#### `TestDatasetMetadataParsing`
| Test | What it verifies |
|------|-----------------|
| `test_id_stored` | `dataset.id` holds the dataset ID |
| `test_erddap_url_stored` | `dataset.erddap_url` holds the server URL |
| `test_cdm_data_type_parsed` | `cdm_data_type` is read from `NC_GLOBAL` attributes |
| `test_globals_dict_populated` | `globals` dict contains title and institution |
| `test_variables_list_contains_expected_vars` | All variables in the info CSV are in `variables_list` |
| `test_df_variables_index_is_variable_names` | `df_variables` is indexed by variable name |
| `test_standard_name_attribute_parsed` | `standard_name` attribute is present on the `temperature` variable |
| `test_cf_role_attribute_parsed` | `cf_role` attribute is present on the `station_id` variable |
| `test_organization_extracted_from_institution` | `institution` global populates `organizations` list |
| `test_platform_defaults_to_unknown_when_no_platform_global` | Missing platform globals → `"unknown"` |

#### `TestDatasetEOVMapping`
| Test | What it verifies |
|------|-----------------|
| `test_eovs_populated_when_supported_var_present` | `sea_water_temperature` variable produces a non-empty `eovs` list |
| `test_eovs_empty_when_no_supported_standard_names` | Dataset with only unsupported standard names → empty `eovs` |
| `test_first_eov_column_set` | `first_eov_column` is set to the variable name that triggered the first EOV match |

#### `TestDatasetGetDf`
| Test | What it verifies |
|------|-----------------|
| `test_get_df_returns_dataframe` | `get_df()` returns a DataFrame |
| `test_get_df_contains_required_columns` | Output has all columns needed for `datasets.csv` |

---

### `unit/test_compliance_checker.py` — 15 tests

#### `TestPassesAllChecks`
| Test | What it verifies |
|------|-----------------|
| `test_valid_timeseries_dataset_passes` | A complete, valid dataset passes all checks |
| `test_failure_reason_code_empty_on_pass` | `failure_reason_code` is `""` when passing |

#### `TestRequiredVariables`
| Test | What it verifies |
|------|-----------------|
| `test_missing_time_fails` | Missing `time` → `MISSING_REQUIRED_VARS` |
| `test_missing_latitude_fails` | Missing `latitude` → `MISSING_REQUIRED_VARS` |
| `test_missing_longitude_fails` | Missing `longitude` → `MISSING_REQUIRED_VARS` |
| `test_all_required_present_passes` | All three LLAT vars present → passes |

#### `TestSupportedCFName`
| Test | What it verifies |
|------|-----------------|
| `test_dataset_with_sea_water_temperature_passes` | Known EOV standard name → passes |
| `test_dataset_with_no_supported_standard_names_fails` | No CDE-mapped standard names → `NO_SUPPORTED_VARIABLES` |

#### `TestIngestFlag`
| Test | What it verifies |
|------|-----------------|
| `test_no_cde_ingest_flag_passes` | Absent `cde_ingest` global → passes |
| `test_cde_ingest_false_fails` | `cde_ingest=False` → `INGEST_FLAG_FALSE` |
| `test_cde_ingest_true_passes` | `cde_ingest=True` → passes |

#### `TestDepthAndAltitude`
| Test | What it verifies |
|------|-----------------|
| `test_only_depth_passes` | Depth without altitude → passes |
| `test_depth_and_altitude_together_fails` | Both depth and altitude → `DEPTH_AND_ALTITUDE` |
| `test_only_altitude_passes` | Altitude without depth → passes |

---

### `unit/test_profiles.py` — 13 tests

#### `TestGetProfilesHappyPath`
| Test | What it verifies |
|------|-----------------|
| `test_returns_dataframe` | `get_profiles()` returns a DataFrame |
| `test_result_is_not_empty` | A valid dataset produces at least one profile row |
| `test_required_columns_present` | All output columns required by the DB schema are present |
| `test_dataset_id_matches` | `dataset_id` column is populated correctly |
| `test_erddap_url_matches` | `erddap_url` column is populated correctly |
| `test_latitude_preserved` | Latitude from profile IDs survives to the output |
| `test_longitude_preserved` | Longitude from profile IDs survives to the output |
| `test_time_min_is_datetime` | `time_min` column is a datetime dtype after `parse_erddap_dates` |
| `test_depth_defaults_to_zero_when_no_depth_var` | Datasets without a `depth` variable get `depth_min=0`, `depth_max=0` |
| `test_records_per_day_is_positive` | `records_per_day` is calculated and positive |

#### `TestGetProfilesEmptyAndEdgeCases`
| Test | What it verifies |
|------|-----------------|
| `test_empty_profile_ids_returns_empty` | If `get_profile_ids()` returns empty, `get_profiles()` returns empty |
| `test_bad_latitude_profile_filtered_out` | Profile with latitude > 90 is removed by the bad-geometry filter |
| `test_profile_id_column_added_when_missing` | TimeSeries datasets (no `profile_id` variable) get `profile_id=""` |

---

### `unit/test_utils.py` — 11 tests

#### `TestIntersection`
| Test | What it verifies |
|------|-----------------|
| `test_returns_common_elements` | Shared elements from two lists are returned |
| `test_returns_empty_when_no_overlap` | No overlap → empty list |
| `test_excludes_empty_strings` | Empty string `""` is never included in the result |
| `test_order_follows_first_list` | Result order matches the first argument |
| `test_empty_lists_return_empty` | Two empty lists → empty result |

#### `TestCdeEovMappings`
| Test | What it verifies |
|------|-----------------|
| `test_mapping_is_non_empty` | `cde_eov_to_standard_name` has at least one entry |
| `test_most_eovs_map_to_at_least_one_standard_name` | Majority of EOVs have CF standard names (some, e.g. `fishAbundanceAndDistribution`, intentionally have none) |
| `test_sea_water_temperature_is_supported` | `sea_water_temperature` is in `supported_standard_names` |
| `test_df_has_expected_columns` | `df_cde_eov_to_standard_name` has `eov` and `standard_name` columns |
| `test_df_rows_match_mapping` | Every row in the DataFrame is consistent with the dict mapping |
| `test_goos_and_cde_layers_both_collapsed` | `get_cde_eov_to_standard_name()` returns a flat dict keyed by CDE EOV names |

---

### `unit/test_ckan.py` — 11 tests

#### `TestSplitErddapUrl`
| Test | What it verifies |
|------|-----------------|
| `test_standard_tabledap_url` | Splits a standard ERDDAP tabledap URL into host and dataset ID |
| `test_url_with_language_prefix` | Handles URLs with language prefix (`/erddap/fr/tabledap/`) |
| `test_invalid_url_raises_value_error` | Non-ERDDAP URL raises `ValueError` with a clear message |

#### `TestUnescapeAscii`
| Test | What it verifies |
|------|-----------------|
| `test_plain_string_unchanged` | Plain ASCII strings pass through unchanged |
| `test_non_ascii_fallback_returns_input` | Non-decodable input is returned as-is |
| `test_list_unescaping` | `unescape_ascii_list` applies the transform to every element |

#### `TestGetCkanRecords`
| Test | What it verifies |
|------|-----------------|
| `test_returns_dataframe` | `get_ckan_records()` returns a DataFrame |
| `test_dataframe_has_expected_columns` | All columns required by the CKAN join in `__main__.py` are present |
| `test_dataset_id_matched` | A known dataset ID appears in the output |
| `test_title_extracted` | English and French titles are extracted from `title_translated` |
| `test_no_matching_dataset_returns_empty` | Filtering for a non-existent dataset ID returns an empty DataFrame |

---

### `unit/test_harvest_erddap.py` — 7 tests

#### `TestHarvestErddapHappyPath`
| Test | What it verifies |
|------|-----------------|
| `test_result_appended` | `harvest_erddap()` appends one entry to the `result` list |
| `test_result_contains_four_dataframes` | Each result entry is `(profiles, datasets, variables, skipped)` |
| `test_compliant_dataset_appears_in_datasets` | A compliant dataset ID appears in the datasets DataFrame |
| `test_dataset_id_filter_respected` | `limit_dataset_ids` excludes datasets not in the list |

#### `TestHarvestErddapSkipping`
| Test | What it verifies |
|------|-----------------|
| `test_unsupported_cdm_type_skipped` | `Point`-type datasets never reach `get_dataset`; appear in skipped with `CDM_DATA_TYPE_UNSUPPORTED` |
| `test_non_compliant_dataset_added_to_skipped` | A dataset that fails compliance checks is in `skipped`, not `datasets` |
| `test_http_error_adds_to_skipped` | `HTTPError` from `get_dataset` adds the dataset to skipped with `HTTP_ERROR` (also tests the bug fix: `dataset_logger` initialised to module logger before the try block) |

---

### `unit/test_csv_generation.py` — 11 tests

#### `TestDatasetsCsvStructure`
| Test | What it verifies |
|------|-----------------|
| `test_all_required_columns_present` | `datasets.csv` has all columns the DB loader expects |
| `test_dataset_id_is_non_empty` | No blank dataset IDs |
| `test_eovs_is_list_after_roundtrip` | `eovs` column round-trips through CSV as a Python list via `ast.literal_eval` |
| `test_organizations_is_list_after_roundtrip` | Same for `organizations` |
| `test_profile_variables_is_list_after_roundtrip` | Same for `profile_variables` |
| `test_no_duplicate_dataset_ids_after_write` | `drop_duplicates(["erddap_url", "dataset_id"])` produces no duplicates |

#### `TestProfilesCsvStructure`
| Test | What it verifies |
|------|-----------------|
| `test_all_required_columns_present` | `profiles.csv` has all DB-required columns |
| `test_latitude_within_bounds` | All latitudes are in (−90, 90) |
| `test_longitude_within_bounds` | All longitudes are in (−180, 180) |
| `test_depth_min_le_depth_max` | `depth_min ≤ depth_max` for all rows |
| `test_time_min_before_time_max` | `time_min < time_max` for all rows |
| `test_n_records_positive` | Record count is > 0 |
| `test_roundtrip_preserves_row_count` | Writing and re-reading `profiles.csv` preserves the row count |

#### `TestSkippedCsvStructure`
| Test | What it verifies |
|------|-----------------|
| `test_all_required_columns_present` | `skipped.csv` has `erddap_url`, `dataset_id`, `reason_code` |
| `test_reason_code_is_non_empty` | Every skipped row has a non-blank reason code |
| `test_roundtrip_preserves_data` | Reason codes survive a CSV write/read cycle unchanged |

---

### `unit/test_db_loader.py` — 13 tests

#### `TestPrepareProfilesDataframe`
| Test | What it verifies |
|------|-----------------|
| `test_removes_altitude_columns` | `altitude_min`/`altitude_max` are dropped |
| `test_drops_rows_where_time_min_is_null` | Rows with null `time_min` are excluded |
| `test_replaces_empty_strings_with_nan` | Empty strings are replaced with `NaN` before DB insert |
| `test_valid_rows_preserved` | Rows with valid data survive the clean step |

#### `TestEnsureOrganizationPks`
| Test | What it verifies |
|------|-----------------|
| `test_missing_column_gets_empty_arrays` | Missing `organization_pks` column → column of empty lists |
| `test_null_values_replaced_with_empty_lists` | Null values in the column → empty lists |

#### `TestDbLoaderMainFullReload`
| Test | What it verifies |
|------|-----------------|
| `test_drop_constraints_called` | `SELECT drop_constraints()` is executed before data load |
| `test_remove_all_data_called` | `SELECT remove_all_data()` is executed to clear tables |
| `test_profile_process_called` | `SELECT profile_process()` is executed to link profiles |
| `test_set_constraints_called` | `SELECT set_constraints()` is executed to re-add FK constraints |

#### `TestDbLoaderMainIncremental`
| Test | What it verifies |
|------|-----------------|
| `test_create_temp_tables_called` | `SELECT create_temp_tables()` is called to prepare staging |
| `test_process_incremental_update_called` | `SELECT process_incremental_update()` is called for UPSERT |
| `test_drop_constraints_not_called_in_incremental` | Full-reload-only SQL (`drop_constraints`, `remove_all_data`) are NOT called in incremental mode |

---

### `integration/test_full_pipeline.py` — 23 tests

#### `TestHarvestOutput` — validates the raw harvest DataFrames
| Test | What it verifies |
|------|-----------------|
| `test_compliant_dataset_is_harvested` | The compliant test dataset ID appears in the datasets DataFrame |
| `test_at_least_one_profile_extracted` | At least one row is produced in the profiles DataFrame |
| `test_profiles_have_required_columns` | All 9 required profile columns are present |
| `test_dataset_has_eovs` | The harvested dataset has at least one EOV mapped |
| `test_unsupported_dataset_is_skipped` | `test_unsupported_001` (Point type from the allDatasets fixture) does not appear in datasets |
| `test_variables_dataframe_populated` | The variables DataFrame has rows and a `standard_name` column |

#### `TestCsvFilesWritten` — validates the CSV output phase
| Test | What it verifies |
|------|-----------------|
| `test_datasets_csv_exists` | `datasets.csv` is created in the output folder |
| `test_profiles_csv_exists` | `profiles.csv` is created |
| `test_skipped_csv_exists` | `skipped.csv` is created |
| `test_datasets_csv_readable` | `datasets.csv` can be parsed by `pd.read_csv` and is non-empty |
| `test_profiles_csv_readable` | Same for `profiles.csv` |
| `test_datasets_csv_array_columns_parse_correctly` | `eovs`, `organizations`, `profile_variables` survive CSV roundtrip as Python lists |
| `test_ckan_title_merged_into_datasets` | CKAN English title is merged into the `title` column |
| `test_french_title_present` | CKAN French title is present in `title_fr` |

#### `TestDbLoadPhase` — validates the database loading phase
| Test | What it verifies |
|------|-----------------|
| `test_drop_constraints_called` | Full-reload begins by dropping FK constraints |
| `test_remove_all_data_called` | All existing data is cleared before reload |
| `test_profile_process_called` | Profile linkage SQL function is invoked |
| `test_create_hexes_called` | Spatial hex aggregation SQL function is invoked |
| `test_set_constraints_called` | FK constraints are re-applied at the end |

---

## Recommendations for Adding More Tests

### 1. Test the multi-profile (orderByMinMax) code path

All current `get_profiles` unit tests use the `actual_range` shortcut (single-profile dataset). Add tests that exercise the `get_max_min` join path with two or more profiles, using `ERDDAP_PROFILE_IDS_TWO_CSV` and `ERDDAP_TIME_MINMAX_CSV` / `ERDDAP_DEPTH_MINMAX_CSV` from conftest.

```python
@pytest.fixture
def two_station_dataset():
    ds = build_mock_dataset()
    ds.profile_ids = pd.read_csv(StringIO(ERDDAP_PROFILE_IDS_TWO_CSV), skiprows=[1])
    ds.get_profile_ids.return_value = ds.profile_ids.copy()
    # Remove actual_range so get_max_min path is forced
    ds.df_variables.loc["time", "actual_range"] = ""
    ds.df_variables.loc["depth", "actual_range"] = ""
    ds.get_max_min.side_effect = _two_station_max_min  # return 2-row DataFrames
    return ds
```

### 2. Test TimeSeriesProfile CDM type

The current fixtures only cover `TimeSeries`. Add an info CSV fixture with `cdm_data_type=TimeSeriesProfile` and a `profile_id` cf_role variable, then verify the "too many profiles per timeseries" grouping logic inside `get_profiles`.

### 3. Test the 180° meridian crossing in the downloader

`erddap_downloader/download_erddap.py` has special logic to split queries when a polygon crosses the antimeridian. Add unit tests for the query-splitting function directly, using a polygon WKT that straddles ±180°.

### 4. Test incremental DB load data integrity

The current incremental DB loader tests only verify SQL calls. Add tests that:
- Write a first harvest CSV, load it, then write a second CSV with one changed row and one deleted row
- Assert the `process_incremental_update` would UPSERT the changed row and delete the missing one

Since this requires real SQL execution, use SQLite in-memory as the engine (SQLAlchemy 1.x supports it) rather than a MagicMock.

### 5. Add a CF version check test

`utils.py` has this comment:
```python
# TODO: add pytest to verify check_cf_version detects when a newer CF standard names version is available
```
Test `check_cf_version()` by mocking `get_cf_version_from_xml` to return a version string different from the local one and assert that a warning is logged.

```python
def test_check_cf_version_warns_on_update(mocker, caplog):
    mocker.patch(
        "cde_harvester.utils.get_cf_version_from_xml",
        return_value="999"
    )
    with caplog.at_level(logging.WARNING):
        check_cf_version()
    assert "CF standard names update available" in caplog.text
```

### 6. Parametrize compliance checker tests

The four compliance rules are currently tested with separate fixture CSVs. Refactor to `@pytest.mark.parametrize` so every rule variation is explicit and easy to extend:

```python
@pytest.mark.parametrize("info_csv, expected_code", [
    (ERDDAP_INFO_NO_EOVS_CSV,            NO_SUPPORTED_VARIABLES),
    (ERDDAP_INFO_INGEST_FALSE_CSV,       INGEST_FLAG_FALSE),
    (ERDDAP_INFO_DEPTH_AND_ALTITUDE_CSV, DEPTH_AND_ALTITUDE),
])
def test_non_compliant_dataset_rejected(info_csv, expected_code):
    checker = CDEComplianceChecker(build_mock_dataset(info_csv))
    assert checker.passes_all_checks() is False
    assert checker.failure_reason_code == expected_code
```

### 7. Test download scheduler job lifecycle

`download_scheduler.py` has no tests. The core logic (poll → lock → download → update status → email) can be tested by mocking the psycopg2 connection and `downloader_wrapper.run_download_query`. Priority: test the `FOR UPDATE SKIP LOCKED` path and the status transitions (`open` → `in_progress` → `completed`/`failed`).

### 8. Add API route tests

The web API (`web-api/`) has no test coverage. Add a `tests/api/` directory using `supertest` (Node.js) or a mock Express app, and test the `/datasets`, `/tiles`, and `/download` endpoints with a stubbed Knex connection.

---

## Bug Fixed During Test Development

The test suite exposed a latent bug in `harvester/cde_harvester/harvest_erddap.py`:

`dataset_logger` was used in the `except HTTPError` handler before it was guaranteed to be assigned (it was only set after a successful `erddap.get_dataset()` call). When `get_dataset()` raised an `HTTPError`, Python raised `UnboundLocalError`.

**Fix applied:** `dataset_logger = logger` (module-level fallback) is now assigned before the try block. If `get_dataset()` succeeds, `dataset_logger` is then overwritten with `dataset.logger`.
