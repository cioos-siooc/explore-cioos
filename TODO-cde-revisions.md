# Cleanup & maintenance backlog

Produced 2026-08-27 from a full-repo survey at `development-v2 @ 92149f45`.
Updated 2026-08-27 for CI/CD changes merged through `development-v2 @ 6f64fb41`.

**How to read this.** Every item is independently actionable — take them one at a time.
Items marked **[verified]** were re-checked directly against the working tree after the
survey; the rest come from the survey pass and are worth a glance before you act.
File references are `path:line` at the commit above, so they will drift as you work.

**Ordering.** P0 is broken right now. P1 is cheap and independent. P2 is structural and
should not start until P0 is done — a deepening pass with no CI gate is how the drift in
§P2.1 happened in the first place. P3/P4 can be picked up at any time.

There is no `CONTEXT.md` and no `docs/adr/` in this repo, so none of this contradicts a
recorded decision. If you reject an item for a load-bearing reason, an ADR is the place
to record it so a future review does not re-raise it.

---

## P0 — Broken now

### CI / deploy

- [x] **CI invokes a compose service that does not exist.** Fixed by the CI refresh: the deprecated
      manual `harvest.yml` workflow was deleted and the integration workflow now runs the harvest via
      `prefect_worker` after waiting for the Prefect deployment to register. **[verified fixed @ 6f64fb41]**
- [x] **The active branch has no CI.** Fixed for PRs: both integration and unit-test workflows now
      trigger on `main`, `master`, and `development*`, which covers `development-v2`; Python tests,
      the JS API/frontend smoke suite, and the download-request check now run through the integration
      workflow. **[verified fixed @ 6f64fb41]**
- [ ] **`deploy.yml` is not gated on tests.** It reads `github.event.workflow_run.head_branch` in three
      places (lines 11, 13, 29) but its `on:` block only has `push` and `workflow_dispatch`, so that
      expression is always null and falls through to `github.ref_name`. A red build still deploys. **[verified]**
- [ ] CI now installs Node 20 via `actions/setup-node@v4`, so Puppeteer 24 can run, but this still
      differs from `frontend/package.json` (`engines.node >= 22`) and `frontend/Dockerfile`
      (`node:22-alpine`). Align the integration-test runtime with the app runtime.
- [x] `build_and_test.yml` now uses `cp .env.sample .env`, `cp docker-compose.override.yaml.sample ...`,
      and `cp harvest_config.sample.yaml ...` during CI setup. **[verified fixed @ 6f64fb41]**
- [ ] Stale action versions remain partially cleaned up: `actions/checkout@v6` and `setup-uv@v6` are
      current in these workflows, but `actions/setup-node@v4` is still behind the repo's stated
      "v6 current" target. `dorny/paths-filter` is gone with the old path-filtered unit workflow.

### Correctness bugs

- [ ] **`download.js:177` assigns an undeclared global.** `count = tile.json_agg.length;` with no
      `let`/`const`. In non-strict CommonJS this is `global.count`, shared across all requests — if
      `tile.json_agg` is empty the previous request's count is returned. **[verified]**
- [ ] **`/download` never validates `email`.** `download.js:75` registers `check("email").isEmail()`
      *after* `requiredShapeMiddleware()`, whose own `errorHandler` runs first
      (`validatorMiddlewares.js:94`). Nothing calls `validationResult` afterwards, so `email` is
      inserted into `cde.download_jobs` unvalidated at `download.js:175`. **[verified]**
- [ ] **Every download job carries a broken CKAN link.** `download.js:132` is
      `'https://catalogue.cioos.ca/dataset/' ckan_url` — missing `|| ckan_id`. Compare the correct
      form at `shapeQuery.js:173-174`. **[verified]**
- [ ] **`redisFunctions.py:56-58` has an exception handler that always raises.** A bare `except:`
      whose body calls `log.error(...)`, where `log` is the closed file handle from the `with` block
      at line 38. Every entry raises `AttributeError` from inside the handler. The `requests.get` it
      guards (line 54) also has no timeout, discards the response, and hardcodes `http://nginx:4000`. **[verified]**
- [ ] **Three loguru calls silently drop their arguments.** `download_scheduler.py:48, 59, 79` use
      print-style commas (e.g. `logger.info("Starting job:", pk, job_id)`). Loguru formats via
      `str.format`, so with no `{}` in the message the DB host, the PDF flag and the job id are never
      logged. **[verified]**
- [ ] **`downloader` would fail a non-dev install.** `downloader/pyproject.toml` lists `harvester`
      only in `[dependency-groups].dev`, but `download_erddap.py:10,14,15` import it at module scope.
      It works today only because `download_scheduler` also declares it. **[verified]**
- [ ] **`database/7_range_functions.sql` is dead but still executed.** Fully superseded by
      `8_range_functions.sql`; the `db_migrate` glob `[3-9]_*.sql` applies both on every deploy, so
      7 creates the two `range_intersection_length` overloads and 8 immediately drops and recreates
      them. Editing either is quietly pointless. Delete `7_range_functions.sql`. **[verified]**
- [ ] **`/tiles/tracks` caches for 1 hour, not 5 minutes.** `tiles.js:560` passes
      `cache.route({ binary: true })`; `cache.js:81` takes `(duration = '5 minutes')`, so the object
      lands in the duration slot and apicache falls back to its own 1-hour default. `binary` is not
      an apicache option. **[verified]**
- [ ] `preview.js:55` can divide by zero — `CEIL(:NUM_RECORDS / (records_per_day/24))` where
      `records_per_day` is a nullable float, evaluated for every row of an unfiltered join. One bad
      row poisons every `/preview` request.
- [ ] `polygon.js` returns `false` on an invalid polygon (lines 21, 25) and `dbFilter.js:160-165`
      never checks the return value, so `false` is bound into `ST_GeomFromText` → 500. Reachable on
      every route except `/download`.
- [ ] `download_scheduler.py:270-271` builds `UPDATE cde.download_jobs SET {params}` by string
      interpolation, defended by manual `.replace("%","").replace("'","")` at lines 191, 214-216,
      250-251. Convert to bound parameters. **[verified]**
- [ ] `1_schema.sql:573-575` points at `database/migrations/add-harvest-run-prefect-columns.sql` —
      the directory does not exist. Either restore it or drop the reference. **[verified]**

### Open question — resolve before touching spatial code

- [ ] **`polygon.js:13` lat/lon order is unverifiable from that module.** It emits `` `${lat} ${lon}` ``
      into WKT, but `ST_GeomFromText(…,4326)` reads `X Y` — lon first. Either the frontend sends
      `[lon,lat]` pairs and the destructuring names are wrong, or every spatial selection is
      transposed. Confirm against a known selection, then add the test.

---

## P1 — Cheap, independent, safe

### Ignore files & tracked junk

- [ ] `.gitignore` says `venv`, which does not match `.venv`. The four venvs (1.6 GB) are ignored
      only by uv's own generated `.venv/.gitignore`. Add `.venv/`. **[verified]**
- [ ] **`.claude/` is not ignored, and holds three full worktrees (1.5 GB) inside the repo**
      (`coastline-visibility`, `harvest-point-datasets`, `topbar-corner-radius`). A `git add -A`
      commits three broken gitlinks. Add `.claude/` to `.gitignore`. **[verified]**
- [ ] `*.env` does not match `.env.production` or `.env.development`, so both are tracked and
      unprotected. The six sensitive values in `.env.production` are `op://` 1Password refs resolved
      at deploy (`deploy.yml:30-31`) — **no live credential is committed and no rotation is needed** —
      but a future literal edit would commit cleanly with no warning. Tighten the pattern. **[verified]**
- [ ] `harvest-prod/` (96 MB) is not ignored by name — it is invisible only because a blanket
      `.gitignore:19 *.csv` catches its contents. That blanket will also swallow future CSV fixtures
      outside `harvester/`. Ignore the directory explicitly.
- [ ] Also unignored: `.pytest_cache/`, `.ruff_cache/`, `downloads/`. **[verified]**
- [ ] `frontend/.DS_Store` is tracked despite `.gitignore:1` — added before the rule. `git rm --cached`.
- [ ] `downloader/` has no `.gitignore` at all (harvester and download_scheduler each have one).

### Docker

- [ ] **Add a `.dockerignore` per build context.** Only the root one exists, and it applies only to
      its own context. `frontend` ships 529 MB and `web-api` 104 MB per build. **[verified]**
- [ ] **Both JS images `COPY` host `node_modules` over `npm ci`** — so the image's dependency tree is
      whatever was on the developer's laptop, not the lockfile. `frontend/Dockerfile:26` copies after
      `npm ci` (defeating the layer-cache split at 22-23); `web-api/Dockerfile` copies *before*
      `npm ci` (no caching at all, and `.env.sample` lands in the image).
- [ ] Root-context builds send ~3.8 GB: the root `.dockerignore` says `venv` not `.venv`, and omits
      `.claude/`, `harvester_cache/` (712 MB), `harvester_logs/`, `nginx/logs/`, `obis/`,
      `harvest_config.yaml`. It has drifted from `.gitignore`.
- [ ] **`SENTRY_AUTH_TOKEN` is passed as a build ARG then promoted to ENV**
      (`docker-compose.production.yaml:29`, `frontend/Dockerfile:9,18`) — recoverable from image
      metadata via `docker history` / `inspect`. Use a BuildKit secret mount; the repo already does
      this for the uv cache.
- [ ] **Zero `HEALTHCHECK` and zero `USER` across all six Dockerfiles.** 7 of 9 compose services have
      no healthcheck, including `web-api` and `nginx`. `nginx` uses plain `depends_on: [web-api]`
      without `condition: service_healthy`, so it serves 502s during every deploy window. An unmerged
      `feat/add-health-checks` branch (`3efc16ad`) exists. **[verified]**
- [ ] Pin floating images: `web-api/Dockerfile:1` `node:alpine` (no version at all),
      `frontend/Dockerfile:30` `nginx` (untagged), `docker-compose.yaml:305` `redis:alpine`.
      `nginx/Dockerfile:1` correctly pins `nginx:1.27.4` — match that.
- [ ] `harvester/Dockerfile:15` falls back to `uv lock && uv sync` on a lock mismatch, silently
      regenerating the lockfile mid-build and defeating `--locked`. `download_scheduler/Dockerfile:22`
      omits `--locked` entirely and its `apt-get` has no `--no-install-recommends` and no list cleanup.
- [ ] `docker-compose.production.yaml:12` publishes the Postgres port to the host in production while
      local dev deliberately does not — inverted from a security standpoint.
- [ ] Four services repeat `env_file: [.env]` with no YAML anchor; `DB_HOST_EXTERNAL` and `REDIS_HOST`
      are set in three places with different defaults. `TODO.md` already names "Fix docker compose
      handling with override or not" as an open item.

### Tooling & gates

- [ ] **Add a lint/build gate; expand the new test gate.** CI now runs `uv run pytest`,
      `harvester/tests/unit`, `downloader/tests`, the JS API/frontend smoke suite, and a bounded
      download-request integration check. Still missing: `npm run lint`, a Python linter, and a
      frontend production build gate. ESLint configs and Prettier remain editor-only decoration.
      **[CI partially fixed @ 6f64fb41]**
- [ ] **No `.pre-commit-config.yaml`.** Nothing enforces the `.gitattributes` LF policy, and nothing
      would have caught `frontend/.DS_Store` or `.env.production`.
- [ ] **Commit a ruff config and run `ruff --fix`.** `ruff check` reports **126 errors, 51
      auto-fixable**: 15 unsorted-import, 10 unused-import, 8 `logging-exc-info`, 6 *stale* `noqa`
      (someone silenced findings with a tool no longer in use), 4 f-string-no-placeholder, 4
      `logging-warn`, 4 unused-variable, 2 bare-except, 2 try-except-pass, 2 naive-datetime.
      No `[tool.ruff]`, `[tool.black]` or `[tool.mypy]` exists anywhere despite a `.ruff_cache/` on disk.
- [ ] `web-api/.eslintrc.js` declares `sourceType: "module"` and `env.browser: true` for CommonJS
      Node code. `web-api` has `lint:fix` but no `lint` script. Prettier is installed with no config
      and is never extended.
- [ ] The two projects use contradictory styles — `frontend` standard/no-semi/single-quote vs
      `web-api` airbnb-base/double-quote. Pick one for shared or copied code.
- [ ] ESLint 8 (EOL Oct 2024) and Prettier 2 in both, on legacy `.eslintrc` rather than flat config.
- [x] **Revive the orphaned root `test/`.** The CI refresh restored the JS suite as an active
      integration smoke test: `npm --prefix test test` now runs API and frontend checks against
      harvested data, and `.github/scripts/test-download-request.sh` covers the download path.
      **[verified fixed @ 6f64fb41]**
- [ ] Rename `CODEOWNER` → `CODEOWNERS`. GitHub only recognises the plural, so no review is ever
      auto-requested. **[verified]**
- [ ] Add a `LICENSE` — `frontend/package.json` declares ISC and the repo is public, with no licence text.
- [ ] Add `CONTRIBUTING.md` and a `dependabot.yml`. There is nowhere a new contributor can learn the
      conventions, especially with two ESLint configs and no gate.

### Dependencies

- [ ] **Drop 7 unused `web-api` dependencies**: `@mapbox/sphericalmercator`, `cache-manager`,
      `ioredis`, `lru-cache`, `validator` — plus `prettier` and `eslint-config-prettier`, which are in
      production `dependencies`.
- [ ] Collapse three overlapping stacks: two Redis clients (`redis` used, `ioredis` dead), three cache
      libraries (only `apicache` used), two validators (`express-validator` used, standalone
      `validator` dead and already transitive). Note `utils/cache.js` carries a hand-written shim
      because `apicache@1.6.3` speaks the node_redis v2/v3 callback API while `redis@5` is
      promise-based — the used pair is itself a version mismatch being papered over.
- [ ] **Sentry is four majors apart** — `@sentry/node@^6` plus the long-deprecated `@sentry/tracing`
      in `web-api` vs `@sentry/react@^10` in `frontend`, both reporting to the same org.
- [ ] Stale `web-api` pins: `dotenv@^10` (17.x current), `uuid@^8` (11.x), `debug@~2.6.9` (2017),
      `http-errors@~1.6.3`, `cookie-parser@~1.4.4`. `cookie-parser`, `http-errors`, `views/` and
      `public/` are express-generator remnants in a stateless JSON/tile service.
- [ ] Three dead frontend dev deps: `eslint-config-airbnb-base` (never extended),
      `eslint-plugin-node` (renamed to `eslint-plugin-n` upstream), `eslint-plugin-standard`
      (dropped by `eslint-config-standard@17`). Also a dead `allowScripts` block naming
      `@lavamoat/allow-scripts`, which is not installed, with stale pinned versions; and an empty
      `"overrides": {}`.
- [ ] `@turf/*` pinned `^6.5.0`, two majors behind. `lodash` imported 13× as full CJS rather than
      `lodash-es` — a bundle-size cost in a Vite build.
- [ ] **Consolidate the Python packaging.** Four `.venv` (1.6 GB) and four `uv.lock` for one
      deployable system. CI resolves from the root lock but `harvester/Dockerfile` resolves from
      `harvester/uv.lock`, so the image and the tested code can pin different transitive versions.
      Note the root `pyproject.toml` workspace omits `downloader` entirely. **[verified]**
- [ ] Python floors disagree: `>=3.10,<3.11` in harvester and downloader, unbounded `>=3.10` in
      download_scheduler, root `>=3.10` — so the root lock carries markers for 3.11–3.13 that can
      never be satisfied. `erddapy` and `shapely` bounds have drifted between projects for no stated
      reason. `downloader/pyproject.toml:4` has download_scheduler's description pasted in.
- [ ] `download_scheduler` has no dev group and no pytest at all; `downloader` pins pytest 8 while
      harvester pins 9.

---

## P2 — Structural (the deepening candidates)

Each of these is a larger piece of work. See the HTML review for before/after diagrams.
**Do not start these until P0's CI items are done.**

### P2.1 — One module owns what a selection is `[Strong]`

`web-api/utils/dbFilter.js`, `utils/shapeQuery.js`, `routes/{tiles,legend,timeExtent,download,griddapCoverage}.js`

- [ ] The profiles / trajectory / obis / griddap branch set is written out **five times** and its
      `includeProfiles` gating predicate **six times**, verbatim. The copies have already drifted —
      three of the P0 correctness bugs above are that drift.
- [ ] Also drifted: `download.js:113-124` omits the obis branch entirely, so `/downloadEstimate` and
      `/download` disagree about what a selection contains. `shapeQuery.js:29` omits `show_as_point`
      where `timeExtent.js:99` applies it, so the time axis and the dataset list are computed over
      different feature sets.
- [ ] Hex-tier thresholds are encoded four times: `tiles.js:148-154`, `tiles.js:387-389`,
      `tiles.js:47`, and again in SQL at `4_create_hexes.sql:49,56,66,78`.
- [ ] `dbFilter.js` returns `hasObisOnly` and `hasProfileOnly`, which have **zero consumers**.
- [ ] Target: one module returning the branch set for a query; routes compose it.

### P2.2 — Accept the database, don't construct it `[Strong]` — *best first move*

`web-api/db.js`, `utils/*.js`, all 20 route modules

- [ ] `db.js:13` constructs the knex pool at import and exports the instance; 16 route modules and
      both filter utils `require("../db")` directly. Merely `require`-ing `dbFilter.js` opens a pool
      and logs "Connected to DB".
- [ ] Consequence: the ~95% of the data-access code that is pure string assembly cannot run without
      a live Postgres. `dbFilter.js:224-226` returns `db.raw(...)` *objects*, so even asserting the
      emitted predicate needs a knex instance.
- [ ] `utils/redis.js` exports a client constructed from env at import, not a factory.
      `utils/cache.js` memoizes a module-level promise, so a test can exercise only one of its two
      branches per process — and its `catch` degrades to in-memory silently, which its own comment
      says took a production debugging session to find.
- [ ] Target: pass the database in; let the filter modules return SQL rather than execute it. Two
      adapters (Postgres, fake) justify the seam. This unlocks P2.1 and P2.3.

### P2.3 — Every route through the same shape `[Strong]`

`web-api/routes/*.js`, `utils/validatorMiddlewares.js`

- [ ] Each of the 20 routes reinvents the validate → filter → query → cache pipeline, and the stage
      *order* differs: `/legend` and `/timeExtent` register cache **before** the validator, while
      `/tiles` and `/datasetRecordsList` do the reverse.
- [ ] Never validated on any route: `platforms`, `obisNodes`, `erddapServers`, `includeObis`,
      `includeTrajectory`, `metric`, `profileTypes`, `trajectoryTypes`. Route `:params` are
      unvalidated everywhere except `/nonna` — a non-numeric `z` reaches `ST_Expand(…, NaN)` → 500.
- [ ] `validatorMiddlewares.js:9-11` claims `/pointQuery` is covered; it has no validation at all,
      and neither do `/downloadEstimate` or `/griddapCoverage`, all three of which take the full filter set.
- [ ] `requiredShapeMiddleware` is declared `(req,res,next)` but called with no arguments and returns
      a module-level shared `router`; every invocation appends another copy of the stack to it.
- [ ] Four different failure modes for the same DB error: 500, rethrow-to-`express-async-errors`,
      `next(err)`, and **404** (`download.js:180-184`). The `ScientificNameSelectionTooBroadError`
      → 400 block is copy-pasted **ten times**.
- [ ] `/tiles/tracks` hand-picks six filter keys (`tiles.js:578-580`), silently dropping `polygon`,
      the lat/lon envelope, depth, `pointPKs` and `scientificNames` — and applies `eovs` at
      dataset level where the other branches apply it at feature level.

### P2.4 — A neutral module under the Python tree `[Strong]`

`harvester/cde_harvester/core/*`, `downloader/`, `download_scheduler/`

- [ ] `downloader` and `download_scheduler` import the *harvester* package, dragging Prefect, duckdb,
      redis and pandera in behind an ERDDAP reader. There is no neutral `cde_common`.
- [ ] **Two different env vars for one host**: `core/db.py:20` reads `DB_HOST_EXTERNAL`;
      `download_scheduler.py:47` reads `DB_HOST` — while importing `cde_harvester.core`. Every
      `.env.sample` ships `DB_HOST`, so copying the sample silently yields the `"localhost"` default
      rather than an error. **[verified]**
- [ ] The `requests` retry-session builder is written three times with three different policies
      (`client.py:65-78`, `create_ckan_erddap_link.py:21-35`, `populate_vernaculars.py:131-159`).
- [ ] `.env` loading duplicated three times with three different sentinel guards; `core/db.py:18`
      calls `load_dotenv` *inside* `database_url()`, so it re-runs on every engine creation.
- [ ] Two `sentry_sdk.init()` calls with different logging integrations and different
      `traces_sample_rate`; two logging stacks (stdlib+Prefect vs loguru) duck-typed through
      `report_issues`.
- [ ] `download_erddap.py` imports **two** ERDDAP clients and aliases one as `cde_harvester`,
      shadowing the top-level package name inside the module.
- [ ] Missing timeouts on `requests` calls: `platform_vocab.py:35,80`, and
      `download_erddap.py:276` on the *main data download path* — a hung ERDDAP stalls the
      scheduler's single-threaded `while True` loop forever.
- [ ] Target: one module holding the connection url, `.env` loading, retry session, Sentry init and
      issue reporting, with the harvest pipeline sitting above it rather than beneath.

### P2.5 — Schema change needs a module, not a glob `[Strong]`

`database/*.sql`, `database/Dockerfile`, `docker-compose.yaml:55-81`

- [ ] Two disjoint mechanisms, neither versioned: initdb (fresh volume only) and the `db_migrate`
      one-shot globbing `/database/[3-9]_*.sql` on every deploy. No version table, no transaction
      across files, no rollback — nothing can tell you which state a database is in.
- [ ] `1_schema.sql` is not idempotent (`CREATE schema cde;`, plus `DROP TABLE IF EXISTS` ×18) and is
      deliberately excluded from the glob, so schema change means "drop the volume and re-harvest"
      (`database/README.md:7-9`, `recreate_database.sh`).
- [ ] The `[3-9]` single-character class silently skips a future `10_*.sql`. Two files already share
      the `7_` prefix. **[verified]**
- [ ] **A live availability window on every deploy**: `8_range_functions.sql:67-68` drops
      `cde.day_union_count` and recreates it at :120, and `psql -f` gives each statement its own
      transaction. Any `/legend` or `/tiles?metric=days` request in that gap fails.
- [ ] `remove_all_data()` truncates `hexes_zoom_0/1`, destroying the "hex pks are stable forever"
      invariant asserted at `1_schema.sql:13-19`.
- [ ] Unqualified `CREATE OR REPLACE FUNCTION` in `3_`–`9_`: `1_schema.sql:11`'s `SET search_path` is
      session-scoped and does not carry into separate `psql` invocations, and `db_migrate` never sets it.

### P2.6 — Give `Map.jsx` a seam that isn't WebGL `[Strong]` — *largest prize, largest risk*

`frontend/src/components/Map/Map.jsx` — 3508 lines, one default export

- [ ] 21 `useEffect`, 38 `useRef`, 2 `useState`, 29 props, 21 `addLayer`. **~1900 lines sit behind a
      live WebGL context.** The mount effect alone is 1481 lines (1879–3359). **[verified]**
- [ ] The render body monkey-patches MapboxDraw's mode table (266–331) and allocates a fresh
      `MapboxDraw` (450) and `Popup` (699) on **every render**, plus nine ref writes during render.
- [ ] **Twin maths kept in step by hand**: `radiusExpression` (854–869) builds a MapLibre expression
      and `pointRadiusFor` (873–884) re-implements the same arithmetic in JS. The test that would
      keep them honest cannot be written — neither is exported, and one reads
      `pointRadiusRange.current` from closure rather than taking it as an argument. **Fix this slice first.**
- [ ] Re-entrancy is held by **eight ad-hoc idempotence guards** (`hexRangeDirty`, `appliedFocus`,
      `trackFocusApplied`, `hexesRevealed`, `rampMeasuredForPk`, `wmsRenderToken`,
      `lastClickHandledAt`, `appliedTrailRef`), each documented as fixing one loop or flicker.
- [ ] Pure but unexported, so untestable: `buildTileSuffix` (163–190, the whole tile query contract),
      `tracksTimeWindow` (519–537), `rampExpression` (826–830), `featureHasDataset` (752–758),
      `dedupeGriddapByPk`, `datasetPksOf`, and the dedupe/role/bbox rules inside `buildFeatureQuery`
      (2824–3049, 225 lines).
- [ ] `setColorStops` (908–1004, 96 lines) has **five entry points** — an effect, a `zoomend`
      listener, the `load` handler, and two functions reached via `setColorStopsRef`.
- [ ] Dead: prop `setDatasetsSelected` (:230) is never used, yet `MapContainer.jsx:14` reads it from
      context solely to forward it. Layer id `'points-hovered'` (:894) is in `POINT_LAYERS` but never
      added; a `getLayer` guard makes it silently inert. **[verified]**
- [ ] `Map.jsx` reads the URL directly twice (`useSearchParams` at 247, and `new URL(window.location.href)`
      at 2467 inside the `load` handler), bypassing both context and its props. There are five
      independent readers of `window.location` across the state modules.

### P2.7 — One descriptor for the metric and the tiers `[Worth exploring]`

`frontend/src/components/{config.js,Map/Map.jsx,Controls/Legend/Legend.jsx}`, `utilities.jsx`,
`state/dataLayers.js`, `web-api/utils/hexMetric.js`, `routes/{tiles,legend}.js`

- [ ] Changing one metric touches **16 locations across 12 files**: the constant, two independent
      senders (`Map.jsx:168` and `MapStateProvider.jsx:304`), three label call sites, four translation
      keys, three swagger enums, and the expression table.
- [ ] Spelled out on both sides of the wire: the MVT source-layer names, the z5 and z7 tier
      thresholds, and the `cdm_data_type` values (`dataLayers.js:111-122` vs `tiles.js:59,168`).
- [ ] Duplication *within* each side is the cheaper first move: the frontend has a bare `7` at four
      sites despite exporting `MARKER_MIN_ZOOM`; the server repeats the `z < 5` tier triple verbatim
      in two routes.
- [ ] Latent bug this surfaced: `Legend.jsx:277` detects a clamped ramp via `rangeLevel?.[2]`, but
      `quantizeCountRange` returns a **two**-element array and the provider prefers the viewport
      range over the tier — so the `+` clamp indicator can never appear when the ramp is
      viewport-scaled. Nothing records this.
- [ ] Note: `frontend` is a Vite bundle and `web-api` is CommonJS, so a genuinely shared module is a
      build decision. That is why this is *worth exploring* rather than *strong*.

### P2.8 — Providers that expose intent, not setters `[Worth exploring]`

`frontend/src/state/{map/MapStateProvider,filters/FilterProvider,selection/SelectionProvider}.jsx`,
`components/Map/MapContainer.jsx`

- [ ] 112 context keys across the three providers. Roughly 40 of `MapStateProvider`'s 64 and 44 of
      `FilterProvider`'s 48 are raw `useState` pairs re-exported unchanged. Deletion test: removing
      them moves complexity to callers rather than concentrating it.
- [ ] The six that already earn their place are the model: `setLoading` (also flips `mapLoaded`),
      `toggleTrackLines`, `setViewportHexRange` (dedupes), `hexRangeLevel` (derived),
      `zoomToGeometry` and `requestDraw` (own the nonce protocol).
- [ ] **Derived twice, disagrees during a gesture**: `getCurrentRangeLevel` runs in the provider from
      `mapView.zoom` (updated only on `moveend`/`idle`) and again at `Map.jsx:927` from the live
      camera. While zooming, the legend's numbers and the hex paint are keyed to different tiers.
- [ ] Four query strings are built from the same `query` object in four modules
      (`MapStateProvider.jsx:104`, `SelectionProvider.jsx:466`, `FilterProvider.jsx:168`, `Map.jsx:540`).
- [ ] `FilterProvider.jsx:127-157` — the effect body reads the *undebounced* values while its
      dependency array lists the *debounced* ones (22 inputs vs 12 deps).
- [ ] Two upward write-backs force the provider nesting order: `SelectionProvider.jsx:272-280`
      (`setMapDatasetPKs`) and `:543-557` (`setActiveWmsOverlay`).
- [ ] `MapContainer.jsx` forwards 29 props; its own contribution is two handlers. The app has both
      conventions — context everywhere else, prop drilling into the map — and the boundary is exactly here.
- [ ] Pure naming, no behaviour (both commented as deliberate — confirm rather than remove blind):
      `dataLayersAreDefault` is a literal alias of `allDataLayersOn`; `showAllDataLayers` and
      `resetDataLayers` are functionally identical.
- [ ] Trivially shallow, safe to inline: `coverageHexOutlineColor` (`Map.jsx:905`) is
      `() => hexOutlineColor`; `hexFillColor` and `coverageHexFillColor` are the same shape.

---

## P3 — Performance (visible statically, not yet measured)

- [ ] **No index on `time_min`/`time_max` or `depth_min`/`depth_max`** on any of the three cell
      tables — and the time filter fires on every slider drag (`dbFilter.js:86,90,113,117`).
- [ ] **`cde.datasets` has almost no indexes.** Nothing on `pk_url`, `platform`, `cdm_data_type` or
      `source_type`; no GIN on `organization_pks`, `eovs` or `obis_nodes` — all actively filtered.
- [ ] **`/legend` has no spatial prefilter** while `/tiles` prunes each branch (whose comment measures
      the unpruned cost at ~2.5 s CPU per tile), then `percentile_disc` forces a full sort of every
      group. `/legend` gates first map paint.
- [ ] **The `scientificNames` expansion query runs per tile** (`dbFilter.js:192`) — ~20 identical GIN
      scans per viewport, unmemoized, fired serially before the main query. `/download` calls
      `createDBFilter` twice (`download.js:94-95` plus `shapeQuery.js:8`), so it fires twice there.
- [ ] **`/harvest` slug resolution can use no index** — a `DISTINCT` over the whole append-only
      attempts table plus a double `regexp_replace` per row, on every one of three routes
      (`harvest.js:53-57`). `listServers` also has a correlated scalar subquery inside a `GROUP BY`,
      the exact pattern `recentRuns` was restructured to avoid.
- [ ] Eleven routes are unbounded (no LIMIT), several over append-only tables:
      `/datasets`, `/organizations`, `/platforms`, `/oceanVariables`, `/obisNodes`, `/erddapServers`,
      `/trajectories/track`, three `/harvest/*`, and `/pointQuery`.
- [ ] `griddapCoverage.js:57` does `SELECT d.*`, pulling stored geometry and two jsonb blobs to use
      eight fields.
- [ ] `/preview` builds an unfiltered `profiles ⨝ datasets` CTE and filters at the end on an
      unindexable `COALESCE`; it has no cache.
- [ ] MVT tiles are cached as JSON byte arrays — a ~200 KB tile becomes a ~1 MB redis string.
- [ ] Knex pool max is 16 (`db.js:25-29`) while `/legend` uses 2 connections per request and
      `/download` 3+, so ~5 concurrent legend requests saturate it.
- [ ] `4_create_hexes.sql:337-355` computes `ST_Y(ST_Transform(ST_Centroid(...)))` per row in both
      UNION arms — four PostGIS calls per output row, when `hexes_zoom_*` could carry the centroid.
- [ ] `obis_scientific_name_popularity` is `REFRESH MATERIALIZED VIEW CONCURRENTLY`-ed on every load
      to serve an offline `--top N` ordering in `populate_vernaculars.py`.

---

## P4 — Dead weight, docs, and long functions

### Delete

- [ ] `docker-compose-frontend.yaml` — 2022, `version: "3.3"`, superseded.
- [ ] Root `package-lock.json` — 27-byte stub `{"lockfileVersion": 1}`, no `package.json`, dead since 2022. **[verified]**
- [ ] `database/7_range_functions.sql` — see P0.
- [ ] `cron.sh` — calls a nonexistent `harvester` service and a missing `cde_refresh_cache.sh`.
- [ ] `downloader/test_downloader.sh` — iterates `test/*.json`; the directory is `downloader/tests/queries/`.
- [ ] `harvester/cde_db_loader/` — a pure re-export deprecation shim, still listed in the wheel
      (`harvester/pyproject.toml:35`) and documented in three places.
- [ ] `HARVEST_CONFIG_YAML` — a deprecated env channel kept alive in six places.
- [ ] `harvester/run.sh:2` — a commented-out old two-step entrypoint.
- [ ] Rename `database/7_contraints.sql` (misspelled).

### Dead SQL objects

- [ ] `cde.organizations.color` — zero references anywhere.
- [ ] `cde.skipped_datasets` — written by the harvester and SQL, never read by web-api.
- [ ] `cde.profiles.days` — written by `9_incremental_upsert.sql`, not in the Pandera schema, never read.
- [ ] Indexes no query can use, since all geometry filtering goes through `ST_Intersects`:
      `profiles(latitude)`, `profiles(longitude)`, `obis_cells(latitude, longitude)`,
      `trajectory_hexes_latlon_idx`. Plus three overlapping index prefixes on `profiles`
      (`1_schema.sql:206,214,216`) and a prefix overlap on `trajectory_points`.
- [ ] `9_incremental_upsert.sql:186` uses positional `INSERT … SELECT *`, which breaks silently on a
      column reorder — contrast the neighbouring block that spells the list out and explains why.

### Docs

- [ ] **`harvester/uml_diagram.md` is entirely stale** — every filename in its component table
      (lines 179-188) refers to a module that no longer exists.
- [ ] `harvester/README.md:175,352` documents `python -m cde_harvester.ckan`; that package moved to
      `cde_harvester.sources.ckan` and the documented command is broken.
- [ ] **README has four factual errors**: `data_loader_test.sh` does not exist (it is
      `data_loader.sh`); `REACT_APP_API_URL` is CRA-era and Vite ignores it (the variable is
      `API_URL`); "Option 1" omits the `cp docker-compose.override.yaml.sample` step, without which
      the documented localhost URL is unreachable; and `mv .env.sample .env` should be `cp`.
- [ ] `docs/obis-branch-overview.md` and `docs/feat-obis-harvester-changes.md` describe two branches
      that no longer exist, in the present tense, for work that is already merged. Add a dated status
      header or archive them — `docs/incremental-update-performance.md` and
      `docs/incremental-update-v2-plan.md` are the model to copy.
- [ ] `docs/frontend-performance-plan.md` is an open plan with no status header, and three of the
      files it cites are modified in the working tree right now — a header would prevent double work.
- [ ] `docs/api.md` documents 1 of 20 routes and is superseded by the `swagger.js` build. Delete or finish.
- [ ] No architecture doc. The closest things are the comment blocks in `docker-compose.yaml`.
      Consider a `CONTEXT.md` for the domain vocabulary — this backlog had to take its terms from the code.

### Long functions worth splitting

- [ ] `harvester/cde_harvester/loading/loader.py:289 main` — **678 lines**, 70% of its module. Does
      connect → path construction → 8 CSV reads → transform → advisory lock → COPY → orchestrate 20+
      stored procedures → `VACUUM`, and reads `CDE_PRUNE_STALE` / `CDE_ALLOW_FULL_RELOAD` *inside*
      the load, 350 lines below the entrypoint. Its only seam is the `folder` string. No docstring.
- [ ] `dataset_types/tabledap_features.py:103 extract_features` — 286 lines, 74% of its module.
- [ ] `cde_harvester/__main__.py:331 main` — 232 lines, with a 60-line `except Exception` that has to
      re-derive its own context.
- [ ] `sources/erddap/harvester.py:145 harvest` — 220 lines.
- [ ] `downloader/erddap_downloader/download_erddap.py:180 get_datasets` — 219 lines; builds URLs,
      streams HTTP with a byte budget, parses CSV, filters by polygon, writes files, generates PDFs.
      Also mixes two definitions of a megabyte in one file (`ONE_MB = 10**6` vs `1024**2`) and
      accumulates via `sys.getsizeof(chunk)`, overcounting by the bytes-object header per chunk.
- [ ] `prefect_pipeline.py` — 671 lines, the largest **untested** module, holding 10 of the 43 broad
      `except Exception` handlers, four of them a log-and-`raise` in 40 lines.

### Test coverage gaps

- [ ] **`frontend` and `web-api` still have zero unit tests.** The root `test/` suite is now a useful
      CI smoke/integration gate, but the highest-value pure targets remain uncovered:
      `utilities.jsx` `generateColorStops` (and `snapCount`, which has the delicate `log10/pow`
      round-trip), `state/dataLayers.js` (essentially the whole file), `config.js` `isMarkerTier` and
      `effectiveTrailingDays`, and `web-api/utils/hexMetric.js` — the module whose own header warns
      that if its two expressions disagree, the ramp silently mis-colours.
- [ ] Pure but **unexported**, so unreachable: `tiles.js` `tileCellPrefilter`,
      `requestedTrajectoryTypes` and `trajectoryTypePredicate` (the SQL-injection allowlist boundary),
      `legend.js` `rampRange`, `harvest.js` `slugify`/`unslug`, `nonna.js` LRU and `withTimeout`.
- [ ] **`download_scheduler` has no tests at all** — no `tests/` dir, no pytest dependency. That
      includes `run_download` (105 lines), `email_user` (73 lines, bilingual templating),
      `update_download_jobs` (the string-built SQL) and `send_email`.
- [ ] `downloader` has one 81-line test file; `download_pdf.py`, `zip_folder.py` and
      `downloader_wrapper.py` are untested.
- [ ] Largest untested harvester modules: `prefect_pipeline.py` (671), `sources/obis/harvester.py`
      (480), `loading/populate_vernaculars.py` (595), `core/observability.py`, `core/db.py` (every DB
      connection in the system), `redisFunctions.py` (which holds the always-raising handler).
- [ ] The harvester integration test asserts *which SQL strings* are executed against a `MagicMock` —
      all 27 stored-procedure calls in `loader.py` are verified as strings. The contract with
      `database/*.sql` is untested from Python.
- [ ] `harvester/tests/unit/__pycache__/` holds bytecode for three deleted test files
      (`test_config`, `test_listing_extent_skip`, `test_trajectory_corridors`) — tests removed
      without a note.

### Config sprawl

- [ ] `HARVESTER_LOG_DIR` is read independently at `__main__.py:599` and `prefect_pipeline.py:206`,
      both with the same fallback — two owners of one precedence rule.
- [ ] `HARVEST_CONFIG_FILE` is read by the designated resolver `core/config.py:112` *and* directly at
      `__main__.py:571`, bypassing its four-level precedence chain.
- [ ] `CDE_ALLOW_FULL_RELOAD` is read at `loader.py:667` and separately marshalled at
      `prefect_pipeline.py:368`.
- [ ] `harvester/.env.sample` ships `DB_HOST` but the code reads `DB_HOST_EXTERNAL`, so copying the
      sample silently yields a default instead of an error. Neither sample documents `DB_PORT`,
      `HARVEST_CONFIG_*`, `DOWNLOAD_WAF_URL`, `HARVESTER_LOG_DIR`, `CDE_PRUNE_STALE` or
      `CDE_ALLOW_FULL_RELOAD`. The same `DB_PASSWORD` placeholder is duplicated across four sample
      files with no source of truth, and `download_scheduler/.env.sample` has already drifted.
- [ ] Hardcoded infrastructure in source: `http://nginx:4000` and `redis:6379` (with a
      `##TODO use env varibles here`), the container path `/app/nginx/logs/access.log*` baked into a
      Python glob, three separate hardcodings of the CKAN base URL — and
      `create_ckan_obis_link.py:19` points at a **preprod** host.
- [ ] `redisFunctions.py` is camelCase in an otherwise snake_case tree (module and functions), and
      uses a bare `result[0:4999]` slice and a positional `line.split(" ")[6]` nginx-log field index.
- [ ] `sources/erddap/client.py:175` has a mutable default argument (`skiprows=[1]`) on the hottest
      function in the client; `MAX_RESPONSE_SIZE = 2e8` is a float used as a byte threshold;
      `timeout=3600` appears inline twice.
- [ ] Redis is unauthenticated — `redis-config/redis.conf` sets no `requirepass` and
      `web-api/utils/redis.js:13` treats `REDIS_PASSWORD` as optional, relying entirely on `expose:`
      keeping it off the host network.
