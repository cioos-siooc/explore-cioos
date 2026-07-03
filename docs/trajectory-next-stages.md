# Trajectory datasets — remaining stages (M3–M5)

Handoff document for implementing the rest of the trajectory-dataset integration.
Written 2026-07-03 on branch `feat/m2-trajectory-datasets`. Read this top to bottom
before touching code: the architecture decisions here were made deliberately with the
project owner and should not be re-litigated without a reason.

## What already works (M2 — done on this branch)

- The harvester extracts `Trajectory` / `TrajectoryProfile` datasets as **coverage
  cells**: decimated positions snapped to a 0.05° grid, one row per
  (trajectory, cell) with `time_min/max`, `depth_min/max`, `n_records`, `n_profiles`,
  `records_per_day`, `days`. Extraction lives in
  `harvester/cde_harvester/dataset_types/trajectory_features.py` (server-side
  `orderBy…` binning with a chunked-download fallback), dispatched through the
  strategy registry in `harvester/cde_harvester/dataset_types/`.
- Cells flow through the standard pipeline: `trajectory_cells.csv` in the per-run
  folder → `temp_trajectory_cells` (COPY, see
  `harvester/cde_harvester/loading/loader.py::load_cells_copy`) →
  `cde.trajectory_cells` via `process_incremental_update()`
  (`database/9_incremental_upsert.sql`) → `cde.points` → the two hex layers.
- web-api includes trajectory_cells in `/tiles` (hex counts, z<7 only — this is what
  keeps trajectories invisible at high zoom for now), `/legend`,
  `/pointQuery` selection (`web-api/utils/shapeQuery.js`), and `/download`.
- Unit tests: `harvester/tests/unit/test_trajectory_features.py`,
  `test_db_loader.py` (includes COPY int-rendering regressions), schema-drift test.
- Known fixed bug (keep in mind for new loaders): Postgres COPY does **no casting**.
  Any DataFrame column destined for a `bigint` column must be nullable `Int64`
  before COPY, or pandas float upcasting ("2.0") aborts the load. The prepare
  functions in `loading/loader.py` are the enforcement point.

## Fixed decisions (do not redesign)

1. **Parquet is the durable store** for fine-grained trajectory geometry; ClickHouse
   is a rebuildable copy. ERDDAP stays the source of truth.
2. **Exact lines are hidden at z≥7 unless the dataset is hovered or selected.** This
   makes per-dataset **on-demand GeoJSON** the right serving shape — do NOT build
   trajectory vector tiles. At any instant at most a few datasets need geometry.
   *Amended 2026-07-03:* translucent **coverage corridors** ARE shown at z≥7
   (Stage 1.5) so tracks are discoverable; only the exact line stays
   hover/selected-only. Corridors are pre-built simplified polygons served
   through the existing `/tiles` MVT — that does not violate the
   no-trajectory-vector-tiles rule, which rejected tiling fine line geometry.
3. **ClickHouse sync is incremental per dataset and self-healing**: hash-diff against
   a state table, `DROP PARTITION` + re-insert. A harvest must never fail because
   ClickHouse is down; a fresh ClickHouse volume must rebuild itself from parquet.
4. Compose conventions: base `docker-compose.yaml` publishes **no host ports**
   (Coolify); local-dev ports go in `docker-compose.override.yaml.sample`. Python
   deps via `uv` in `harvester/pyproject.toml`.
5. Historical note: an old PoC (branch `feat/add-trajectory-datasets-jessy`,
   commit `3db64188`, and possibly `stash@{0}`) implemented an MVT `/traj-tiles`
   approach. It is **reference material only** (useful for `orderByClosest`
   coarsen-and-retry details); its tiling architecture was explicitly rejected.

## Stage 1 — Decimated trajectory points → parquet (harvester)

New module, e.g. `harvester/cde_harvester/dataset_types/trajectory_points.py`,
invoked from the trajectory strategy alongside the existing cell extraction (reuse
the responses/queries already made where possible).

- Target **~30,000 decimated points per dataset** (env `TRAJ_TARGET_POINTS`,
  default 30000). Compute the interval from per-trajectory time spans
  (`ceil(Σ durations / target)`), snap UP to an ERDDAP-legal ladder
  (1min, 5min, 15min, 30min, 1h, 3h, 6h, 12h, 1d, 3d, 7d, 30d), then one
  `orderByClosest("{traj_var},time/{interval}")` query for
  `{traj_var},time,latitude,longitude[,depth]`. If the response exceeds 2× target,
  double the interval and retry once. Servers without `orderByClosest` → skip
  points (cells still work), record why.
- **Gap segmentation at harvest time** so all consumers break lines identically:
  sort (trajectory_id, time); new `segment_id` when Δt > max(4×interval, 12h) OR
  consecutive haversine distance > 200 km. Drop bad-geom rows first (same bounds
  as profiles).
- **Parquet contract** — one file per dataset:
  `{TRAJECTORY_DATA_DIR}/{host_slug}/{dataset_id}.parquet`
  (default `/app/harvester/trajectories`; a new named volume `trajectory_data`,
  NOT the per-run harvest folder — this store is durable and exempt from run
  pruning). Write atomically (`.tmp` + `os.replace`). Columns:
  `dataset_key` (string, `{host_slug}/{dataset_id}` — the ClickHouse partition
  unit), `erddap_url`, `dataset_id`, `trajectory_id`, `segment_id` (int32),
  `time` (timestamp ms UTC), `latitude`/`longitude` (float64),
  `depth` (float32, nullable). File-level metadata: run_id, harvested_at,
  decimation_interval, n_trajectories. Use pyarrow (`uv add pyarrow`) for the
  explicit schema; duckdb (already a dep) is fine for test readback.
- Cleanup: after a successful non-limited server harvest, delete that host's
  parquet files whose dataset_id is no longer a harvested trajectory dataset.
  Never delete during `limit_dataset_ids` runs.

Tests: interval-ladder snapping, gap-split (both triggers), retry-on-oversize with
a mocked query, parquet schema + atomic-write round-trip.

## Stage 1.5 — Coverage corridors (trajectory visibility at z≥7)

**Status: implemented on this branch (2026-07-03)** — harvester
(`trajectory_points.py` + `trajectory_footprints.py`), loader COPY + PostGIS
buffering, `cde.trajectory_footprints` (+ migration), `/tiles`
`trajectory-footprints` MVT layer with cumulative-days hover stats,
`/pointQuery` + `/download` corridor selection, Map.js layers/tooltip, env
vars in `.env.sample`. To SEE it: rebuild `prefect_worker` (code is baked
into the image), `docker compose up -d` (db_migrate applies the new table),
re-harvest a trajectory server (footprints only exist after a harvest),
restart web-api, rebuild the frontend.

Amends fixed decision 2 (see note there). Problem being solved: the 1/12°
cells come from **full-resolution** server-side binning, so cells exist only
where records exist; with coarse fix spacing (hourly ship fixes ≈ 22 km) the
hex track turns dotted once hexes are smaller than the spacing. No extra
ERDDAP querying can fill those cells — the records don't exist. The answer is
a translucent buffered **corridor** per dataset at z≥7: visibly "coverage
envelope, not precise track". Rejected alternative (do not revisit):
synthesizing interpolated fill rows into `trajectory_cells` — pollutes
counts/estimates and duplicates what the corridor does honestly.

**Build (harvester, derived from the Stage-1 points — zero extra ERDDAP
queries):**

- Split each Stage-1 segment further at calendar-aligned ~30-day boundaries
  (env `TRAJ_FOOTPRINT_SLICE_DAYS`, default 30) so time filtering trims the
  corridor *spatially*, not just include/exclude whole tracks.
- Per (trajectory_id, segment_id, slice): linestring → buffer by
  `TRAJ_FOOTPRINT_KM` (default 5 — roughly the z6 hex radius; fixed in km so
  the corridor deliberately reads coarser as you zoom in) → simplify.
- One row per slice in a new `cde.trajectory_footprints` table:
  dataset link, `trajectory_id`, `segment_id`, `time_min/max`,
  `depth_min/max`, `geom` (polygon, GIST index). Loader: COPY temp table +
  per-dataset replace, exactly like `trajectory_cells`. New table ⇒
  `1_schema.sql` + `database/migrations/*.sql` (follow database/README.md).
- **No-points fallback** (server lacks `orderByClosest`): union of buffered
  `trajectory_cells` centroids per trajectory — bridges gaps when the buffer
  exceeds half the fix spacing; degrades gracefully, never blocks.

**Serving (`/tiles` branch, z ≥ hexMaxZoom):**

- Same `createDBFilter` plumbing: time/depth filters against slice columns,
  platform/eov/org via the datasets join; redis `cache.route()` unchanged.
- `GROUP BY dataset_pk` with `ST_AsMVTGeom(ST_Union(geom))` — the per-tile
  dissolve is what prevents fill-opacity self-stacking within one dataset.
- Feature properties: dataset pk/title/platform;
  `n_trajectories = count(DISTINCT trajectory_id)` over passing slices; and
  `days` = **cumulative coverage, never last-minus-first**: clamp each slice
  range to the time filter, merge overlapping/adjacent ranges across
  trajectories (gaps-and-islands window query — the DB is **PG 13**, so no
  `range_agg`/multirange until an image upgrade to PG≥14), sum merged
  lengths. Within a segment coverage is continuous by construction (Stage-1
  gap rule), so slice ranges ARE the coverage at day granularity. Merging
  across trajectories is deliberate: `days` = "days with data present";
  simultaneous deployments show as 3 trajectories · 30 days, not 90.
- `/pointQuery`: add footprint intersection to the trajectory branch in
  `web-api/utils/shapeQuery.js` so a click anywhere inside the corridor
  selects the dataset (supersedes Stage 4's click-bbox tweak).

**Frontend (`Map.js`):**

- Corridor fill layer `minzoom: hexMaxZoom`, `fill-opacity` ~0.15–0.2,
  platform `colors` match expression + faint outline. Cross-dataset opacity
  stacking is intentional (reads as corridor density).
- Hover: `queryRenderedFeatures` on the corridor layer → tooltip
  "`{n_trajectories}` trajectories · `{days}` days of records". Do NOT show a
  first–last date span (explicitly rejected: misleading for multi-mission
  datasets). Corridor hover drives the same `hoveredDataset` state, so the
  exact line (Stage 4) sharpens on top of its own corridor.

Tests: calendar-boundary slice splitting, buffer/simplify round-trip,
cumulative-days SQL (simultaneous-trajectory dedupe; filter clamping), tile
branch output, cells-fallback path.

## Stage 2 — ClickHouse service + incremental sync

**Compose** (`docker-compose.yaml`; mirror in production/coolify variants):
`clickhouse` service — `clickhouse/clickhouse-server:24.8`, expose 8123 (host port
only in the override sample), env `CLICKHOUSE_USER`/`CLICKHOUSE_PASSWORD`
(+`CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: 0`), ulimits nofile 262144, volume
`clickhouse-data:/var/lib/clickhouse`, wget `/ping` healthcheck. **No parquet
mount into ClickHouse** — the sync pushes file bytes over HTTP, which also works
for remote workers. **No service gets `depends_on: clickhouse`** — everything must
run without it. `prefect_worker` gets the `trajectory_data` volume +
`TRAJECTORY_DATA_DIR`, `TRAJ_TARGET_POINTS`, `CLICKHOUSE_URL=http://clickhouse:8123`,
user/password env. Add all of these to `.env.sample`. NOTE: a stray `clickhouse`
container from an old experiment may exist on the dev machine — it is not from
this compose file; ignore/remove it.

**Schema** (bootstrap DDL executed by the sync module with `IF NOT EXISTS` —
that IS the ClickHouse migration mechanism):

```sql
CREATE TABLE IF NOT EXISTS cde.trajectory_points (
  dataset_key String, erddap_url LowCardinality(String),
  dataset_id LowCardinality(String), trajectory_id LowCardinality(String),
  segment_id UInt32, time DateTime64(3,'UTC'),
  latitude Float64, longitude Float64, depth Nullable(Float32)
) ENGINE = MergeTree PARTITION BY dataset_key
ORDER BY (dataset_key, trajectory_id, segment_id, time);

CREATE TABLE IF NOT EXISTS cde.trajectory_sync_state (
  dataset_key String, file_sha256 String, n_points UInt64, synced_at DateTime
) ENGINE = ReplacingMergeTree(synced_at) ORDER BY dataset_key;
```

Partition-per-dataset keeps "replace this dataset" a metadata-cheap
`DROP PARTITION` (never `ALTER TABLE … DELETE` — async mutations). Partition
count = number of trajectory datasets (hundreds at most) — fine.

**Sync module** — e.g. `harvester/cde_harvester/loading/clickhouse_sync.py`. Plain
`requests` against the ClickHouse HTTP interface; `INSERT INTO … FORMAT Parquet`
accepts the parquet file bytes verbatim as the POST body, so the sync never parses
files and needs no driver dependency. Algorithm (idempotent, content-addressed):

1. Bootstrap DDL.
2. Scan the WHOLE `TRAJECTORY_DATA_DIR`, sha256 every file; read
   `trajectory_sync_state FINAL`.
3. For each file whose hash is new/changed: `DROP PARTITION` for its key →
   stream-POST the file → upsert the state row. (Sub-second empty window per
   dataset is acceptable for a hover-fetched layer.)
4. **Guarded deletion**: drop a partition only when its key has no parquet file
   AND is absent from `cde.datasets` (one PG query). An empty/wiped parquet
   volume must never mass-drop ClickHouse — log loudly instead.
5. CLI entrypoint for manual full resync.

**Wiring**: a Prefect task called from the pipeline flow
(`harvester/cde_harvester/…prefect pipeline module`) after the db-loader succeeds,
before the redis cache refresh, wrapped so ANY exception logs a warning and
returns — CH down never fails a harvest; the next run's full-scan catches up.
Because the whole dir is scanned every time, a fresh ClickHouse volume self-heals
on the next harvest with zero special-casing.

Verification drill: run harvest → counts appear; re-run same harvest → "hash
unchanged" skips, counts not doubled; `docker compose stop clickhouse` → harvest
still green; wipe `clickhouse-data` volume → next run rebuilds everything.

## Stage 3 — Serving endpoint: `GET /trajectories/:datasetPK`

New `web-api/routes/trajectories.js` + `web-api/utils/clickhouse.js`
(`@clickhouse/client`, typed query params), mounted in `web-api/app.js`.

1. Validate integer pk; PG lookup `dataset_id, erddap_url, platform` from
   `cde.datasets` by pk → derive `dataset_key`. Unknown pk → 404.
2. Query `cde.trajectory_points` filtered by `dataset_key` + optional
   `timeMin/timeMax/depthMin/depthMax` (match the query-param names the other
   routes use), `ORDER BY trajectory_id, segment_id, time`, thinned with
   `LIMIT 1 BY trajectory_id, segment_id, intDiv(toUnixTimestamp(time), {bucket})`
   where `bucket` keeps the output ≤ ~6000 points.
3. Group rows into one `LineString` Feature per (trajectory_id, segment_id); split
   again where filtering created holes (Δt > 4× median spacing). Feature
   properties: `{trajectory_id, platform}` (platform drives line color).
4. `cache.route()` like the other routes (the post-harvest redis cache clear
   invalidates it). ClickHouse unreachable → 503 JSON; the map just shows no line.

## Stage 4 — Frontend: hidden-until-hovered/selected lines

`frontend/src/components/Map/Map.js` (+ `App.jsx`):

- Add a **GeoJSON source** `trajectory` (empty FeatureCollection) and two line
  layers with `minzoom: hexMaxZoom` (7): a white casing (width ~5) and the colored
  line (width ~2.5, `line-color` = the existing platform `colors` match
  expression). GeoJSON, not vector tiles — data arrives per dataset on demand.
- Extend the existing `hoveredDataset` effect: when the hovered dataset's
  `cdm_data_type` starts with `Trajectory` (field already present on `/pointQuery`
  rows) and zoom ≥ 7, fetch
  `${server}/trajectories/${pk}?${createDataFilterQueryString(query)}`
  (AbortController on change; small in-memory cache keyed pk+filters) →
  `getSource('trajectory').setData(...)`; on unhover, set empty. The existing
  grey-out of points/hexes needs no change.
- **Selected persistence**: pass the inspected dataset from `App.jsx` into `Map`
  so the line stays rendered while the dataset detail panel is open (today only
  the hover state reaches the map).
- **Selecting a track**: polygon/box draw and the ~20px click-bbox already flow
  to `/pointQuery`, whose spatial predicate runs server-side against
  `trajectory_cells.geom` — so trajectory datasets already appear in the panel.
  With Stage 1.5, tracks are no longer invisible at z≥7: the corridor is
  clickable/hoverable, and the footprint predicate added to `shapeQuery.js`
  makes clicks inside corridor gaps select the dataset (this supersedes the
  earlier idea of a z≥7 click-bbox fallback).
- `DatasetsTable.jsx`: label `TrajectoryProfile` → `Trajectory / Profile` (chain
  the replace before the plain `Profile` one).

## Stage 5 — Polish / follow-ups

- Download-estimate sanity for trajectory datasets (cells carry
  `records_per_day`; verify `/downloadEstimate` numbers against a known dataset).
- Griddap footprints (M4 of the broader roadmap) — separate feature, not covered
  here.
- Docs: update `harvester/README.md` (new env vars, parquet volume) and
  `database/README.md` if any schema files change (follow its schema-change
  procedure — init SQL is fresh-volume-only; live DBs only get
  `database/migrations/*.sql`).

## Operational gotchas (learned the hard way)

- **Harvester/loader code is baked into the `cde-harvester:latest` image** used by
  `prefect_worker`. After changing harvester or loader code:
  `docker compose build prefect_worker && docker compose up -d prefect_worker`,
  or harvests keep running the old code.
- Failed run folders persist on the `harvest_data` volume
  (`/app/harvester/harvest/{host_slug}/{timestamp}/`). A failed db-load can be
  replayed without re-harvesting by calling the loader `main(folder,
  incremental=True)` against the exposed dev DB (patch Prefect's
  `get_run_logger` when calling `main.fn` outside a flow).
- COPY-based loaders: keep bigint-destined columns `Int64` (see the regression
  tests in `harvester/tests/unit/test_db_loader.py::TestLoadCellsCopy`).
- End-to-end smoke datasets: real Trajectory datasets exist on
  `erddap.ogsl.ca`, `catalogue.hakai.org`, and `erddap.amundsenscience.com`
  (find them via `allDatasets.csv?datasetID,cdm_data_type&cdm_data_type=%22Trajectory%22`).
