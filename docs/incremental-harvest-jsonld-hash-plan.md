# Skip unchanged ERDDAP datasets via JSON-LD file-list hash

## Context

The ERDDAP harvester re-harvests **every** dataset on every run, running the
expensive per-dataset profile queries (`distinct()`, `orderByMinMax()`,
`orderByCount()`) even when nothing changed. We want to skip the heavy harvest for
datasets that haven't been modified, storing a content fingerprint + timestamps so
the decision is reproducible.

**Signal — the ld+json file list.** Each dataset info page
(`/info/{id}/index.html`) carries a `<script type="application/ld+json">` block.
On Croissant-emitting ERDDAPs that expose source files (e.g. Amundsen — see
`amundsen.html` line 2061+) this block contains a **`distribution` array of
`cr:FileObject` entries**, one per file, each with:
- `@id` — the file's **relative path including subdirectories**
  (e.g. `2014_Amundsen_CTD_v1/1405_int_R2/1405_001.int.nc`), so the list is
  **already recursive in a single fetch** (no `/files/` crawling, no paging);
- `contentSize` (e.g. `"186981 B"`) and `contentUrl`.
  (No `md5` / per-file date is emitted — only path + size.)

This `distribution` is **not universal**: database-backed datasets (ONC,
`sourceUrl=(source database)`) and some ERDDAP versions (older Croissant on
cioospacific, classic schema.org on CEOTR) emit **no** `distribution`. That is
exactly the wanted behaviour: **the presence of a non-empty `distribution` of
`FileObject`s is the "files exist" gate.** When the file list is present we can
reliably detect data changes (a file added/removed/resized changes the list);
when it's absent there's no reliable signal, so we always harvest.

**Decisions (with the user):**
- Use ERDDAP's generated Croissant **directly** from its data endpoint
  `/tabledap/{id}.croissant` (file type `.croissant`, no query needed; returns
  `application/ld+json`). One cheap GET, no HTML scraping. Fingerprint = SHA-256 of
  the normalized whole Croissant document (`json.dumps(sort_keys=True)`). Its
  `distribution` lists every file recursively, so file additions/removals/resizes
  change the hash for free (no `/files/` crawling/paging). Requires ERDDAP ≥2.25;
  older servers return 404 → fail-open (always harvest).
- **Skip gate = "files exist"** = the Croissant has a non-empty `distribution` of
  `cr:FileObject`s. Datasets without a file list (DB-backed, or ERDDAP versions that
  don't emit `distribution`) are **always harvested** — their Croissant coverage can
  be stale, so there's no reliable change signal and we must not stale-skip them.
- **Federated datasets** (`EDDTableFromErddap`/`EDDGridFromErddap`, where `sourceUrl`
  is an `http(s)…/erddap/{tabledap,griddap}/<id>` URL and the local ld+json has no
  file list) are handled by **following `sourceUrl` to the origin** and reading the
  origin's ld+json file list. (None exist in the current harvest set — scanned ~160
  datasets across 4 servers — but this future-proofs for when they appear.)
- The skip is only safe in **incremental** DB-load mode (full-reload TRUNCATEs and
  would delete a skipped dataset). The **nightly run is switched to incremental**.
- `verified_at` is bumped **every run**, including when a dataset is skipped.
- We store `content_hash` / `last_updated_at` / `verified_at` for **all** harvested
  datasets for visibility; only datasets with a file list that is unchanged are
  skipped.

**Known limitation (note in PR):** because the Croissant `FileObject`s carry only
path + size (no md5/date), an in-place file edit that keeps the **same path and
byte size** is not detected. Adding/removing/resizing any file — or any metadata/
coverage change ERDDAP reflects in the Croissant — is detected (we hash the whole
document).

## Constraint / architecture note

The harvester writes CSVs; a separate **db-loader** loads them into Postgres. To
decide skip-vs-harvest the harvester needs the *previous* hash, so the harvester
gains **read-only** DB access (it already depends on `sqlalchemy` + `psycopg2-binary`;
reuse the db-loader's env-var connection string). This is **fail-open**: if the DB
is unreachable or has no prior hash, the dataset is harvested normally — so first
runs and local/no-DB runs behave exactly as today. The skip is also gated on a
`skip_unchanged` flag (= effective incremental mode), so a full-reload run never
skips and never loses data.

## Implementation

### 1. Croissant fingerprint helper (harvester)
- `harvester/cde_harvester/ERDDAP.py`: add
  `get_croissant_fingerprint(self, erddap_base, dataset_id, _hops=0) -> tuple[str|None, bool]`
  returning `(content_hash, has_files)`.
  - GET `{erddap_base}/tabledap/{dataset_id}.croissant` via `self.session`;
    `response.json()`. (All harvested datasets are tabledap — `get_all_datasets`
    filters `dataStructure="table"`.)
  - `has_files = any(d.get("@type") == "cr:FileObject" for d in doc.get("distribution", []))`.
  - If `has_files`: `content_hash = sha256(json.dumps(doc, sort_keys=True, separators=(',',':')))`,
    return `(content_hash, True)`.
  - Else if `sourceUrl` (parsed from the doc's `description`, which embeds all
    global attrs) matches `https?://.../erddap/(tabledap|griddap)/<origin_id>` and
    `_hops < 3` → **follow to origin**: recurse
    `get_croissant_fingerprint(origin_base, origin_id, _hops+1)`.
  - Else (no file list / unreachable / pre-2.25 404) → `(None, False)` (fail-open).
  - The harvest loop calls it as `erddap.get_croissant_fingerprint(erddap.url, dataset_id)`.

### 2. Prior-hash lookup (harvester, read-only DB)
- New `harvester/cde_harvester/dataset_state.py`: `load_previous_hashes(erddap_url) -> dict[str,str]`.
  - `SELECT dataset_id, content_hash FROM cde.datasets WHERE erddap_url=:url AND content_hash IS NOT NULL`.
  - Connection string built exactly as `db-loader/cde_db_loader/__main__.py:198-201`
    (`DB_HOST_EXTERNAL`, `DB_USER`, `DB_PASSWORD`, `DB_PORT`, `DB_NAME`).
  - try/except → log warning, return `{}` on any failure (fail-open).

### 3. Skip decision in the harvest loop
- `harvester/cde_harvester/erddap_harvester.py`:
  - `ERDDAPHarvester.__init__`: accept `skip_unchanged=False`. In `harvest()`, when
    `skip_unchanged`, call `load_previous_hashes(self.erddap_url)` once before the loop.
  - `harvest_dataset(...)`: accept `previous_hashes`, `skip_unchanged`. **First**
    compute `(new_hash, has_files) = erddap.get_croissant_fingerprint(erddap.url, dataset_id)`.
    If `skip_unchanged and has_files and new_hash and previous_hashes.get(dataset_id)==new_hash`:
    log `"Skipping {id}: unchanged (Croissant hash match)"` and return a new
    `DatasetHarvestResult(status="skipped_unchanged", verified_at=now,
    attempt=_build_attempt(status="skipped", reason_code=UNCHANGED, ...))` — **one HTTP
    request total**, no metadata, no profile queries.
    Otherwise proceed with the existing full harvest, carrying `new_hash` forward
    (which is `None` for datasets with no file list — stored as NULL).
  - On the **success** path, stash `new_hash` on the dataset so `get_df()` emits it.
  - Add `UNCHANGED = "UNCHANGED"` to `harvester/cde_harvester/harvest_errors.py`.
  - **Important:** an unchanged dataset is *not* added to `skipped_datasets_reasons`
    (that table means "excluded from CDE"). It only yields a `harvest_attempts` audit
    row + a verified-timestamp bump.
  - In `harvest()`, accumulate skipped-unchanged rows into a `verified` DataFrame
    `(erddap_url, dataset_id, verified_at)` returned in `HarvestResult`.

### 4. Dataset row gains the new fields
- `harvester/cde_harvester/dataset.py` `get_df()`: add `content_hash` (=
  `self.content_hash` set by the caller, may be NULL), `last_updated_at` (=now),
  `verified_at` (=now) columns; timestamps via `datetime.now(timezone.utc)`.
- `harvester/cde_harvester/schemas.py` `DatasetSchema`: add `content_hash`
  (nullable str), `last_updated_at` / `verified_at` (nullable `pa.DateTime`). Add a
  small `VerifiedDatasetSchema` for the verified frame.

### 5. Carry `verified` through to a CSV
- `harvester/cde_harvester/base_harvester.py`: add `verified` field to
  `HarvestResult` (default empty, mirroring `obis_cells`/`attempts`).
- `harvester/cde_harvester/__main__.py`: aggregate `result.verified` across ERDDAP
  results (alongside `erddap_datasets`, lines 484-489); pass to `merge_and_write_csvs`.
  Thread a new `skip_unchanged` param through `main(...)` into
  `harvest_erddap.submit(...)` (line 458).
- `harvester/cde_harvester/prefect_pipeline.py`:
  - `merge_and_write_csvs`: write `{folder}/verified.csv`.
  - Compute `effective_incremental` (already at line 272) **before** calling
    `harvester_main` and pass `skip_unchanged=effective_incremental`.

### 6. Database schema + loader
- `database/1_schema.sql` `datasets` table (lines 33-58): add
  `content_hash TEXT`, `last_updated_at timestamptz`, `verified_at timestamptz`.
- New `database/migrations/add-dataset-hash-columns.sql`: idempotent
  `ALTER TABLE cde.datasets ADD COLUMN IF NOT EXISTS ...` (follow
  `database/migrations/add-harvest-run-prefect-columns.sql`).
- `database/9_incremental_upsert.sql` `upsert_datasets_from_temp()`: add the three
  columns to the `DO UPDATE SET` clause. (`INSERT … SELECT * FROM temp_datasets` and
  `create_temp_tables()`'s `LIKE cde.datasets` pick the new columns up
  automatically, so column order stays aligned.)
- `db-loader/cde_db_loader/__main__.py` (incremental branch, after
  `process_incremental_update`): read `verified.csv` if present, load into an inline
  `temp_verified` table and run
  `UPDATE cde.datasets d SET verified_at = v.verified_at FROM temp_verified v
   WHERE d.dataset_id=v.dataset_id AND d.erddap_url=v.erddap_url;`.
  Harvested datasets get `verified_at` via the UPSERT; this covers skipped ones.

### 7. Switch the nightly to incremental
- `harvest_config.production.yaml`: set `incremental: True` (currently `False`) so
  the skip optimization takes effect on the recurring harvest. (`harvest_config.yaml`
  is already `True`.)
- **Caveat to flag:** incremental never prunes datasets that vanished from a source
  (full-reload did via TRUNCATE). Out of scope; possible follow-up (periodic
  reconcile, or a `verified_at` staleness sweep).

## Out of scope / noted
- Datasets that fail compliance or yield no profiles aren't in `cde.datasets`, so
  they have no hash and are still fully re-evaluated every run (no regression).
- See "Known limitation" above (same-path/same-size in-place edits; metadata-only
  edits).

## Verification
1. **Schema**: apply the migration locally; confirm the three columns exist on
   `cde.datasets`.
2. **Fingerprint check**: `get_croissant_fingerprint` against a file-backed dataset
   (`amundsenscience` `cullenj_bscs-3y08` / `amundsen12713`) → stable hash,
   `has_files=True`; against a DB-backed dataset (ONC `scalar_1190543`) →
   `(None, False)`; two calls give the same digest. (Verified live during dev.)
3. **First run** (no prior hashes): harvest one small ERDDAP that exposes files
   (e.g. amundsenscience) → every dataset harvested; `datasets.csv` now carries
   `content_hash` (set for file-list datasets, NULL otherwise) +
   `last_updated_at`/`verified_at`; incremental load lands them in `cde.datasets`.
4. **Second run, unchanged**: re-run the same source → datasets with an unchanged
   file list log `"Skipping … (Croissant hash match)"` and are absent from
   `datasets.csv` but present in `verified.csv`; after load, their `verified_at`
   advanced while `content_hash`/`last_updated_at` are unchanged; their profile rows
   are untouched. Datasets with no file list are re-harvested regardless.
5. **Modified dataset**: alter a stored `content_hash` for one file-list dataset
   (or use one where a file was added) → it is fully re-harvested and
   `last_updated_at` advances.
6. **Fail-open**: with DB env vars unset, `load_previous_hashes` logs a warning,
   returns `{}`, and the harvest proceeds normally (nothing skipped).
