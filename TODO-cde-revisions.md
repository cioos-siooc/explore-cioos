# Cleanup & maintenance backlog

Produced 2026-08-27 from a full-repo survey at `development-v2 @ 92149f45`.
Updated 2026-08-27 for CI/CD changes merged through `development-v2 @ 6f64fb41`.
Updated 2026-09-09 with a second audit pass (GPT Sol 5.6) at `fix/p0-cleanup-backlog @ 26bd6f4d`. Its ten items are folded into the sections below
and tagged **[2026-09-09]**; they are re-prioritised against *this* document's ladder
(P0 = broken now, P1 = cheap and independent, P2 = structural), which is not the
severity ladder the audit used. All ten were re-verified against the working tree
before merging, and line references were corrected where the files had drifted.
Updated 2026-09-10: **§P3 was measured** against a real database rather than read, and
rewritten from the results. Five of its twelve items changed verdict — three were wrong
or already fixed, two needed a different fix from the one proposed — so items closed
there carry the numbers that closed them.

**How to read this.** Every item is independently actionable — take them one at a time.
Items marked **[verified]** were re-checked directly against the working tree after the
survey; the rest come from the survey pass and are worth a glance before you act.
File references are `path:line` at the commit above, so they will drift as you work.

**Ordering.** P0 is broken right now. P1 is cheap and independent. P2 is structural and
should not start until P0 is done — a deepening pass with no CI gate is how the drift in
§P2.1 happened in the first place. P3 has had its first pass; P4 can be picked up at any
time. A P3 item closed "by measurement" should not be re-raised without new numbers —
that section was written statically once and three of its items did not survive contact
with a database.

There is no `CONTEXT.md` and no `docs/adr/` in this repo, so none of this contradicts a
recorded decision. If you reject an item for a load-bearing reason, an ADR is the place
to record it so a future review does not re-raise it.

---

## P0 — Broken now — **first pass COMPLETE** (2026-09-08), one item added 2026-09-09

### CI / deploy

- [x] **CI invokes a compose service that does not exist.** Fixed by the CI refresh: the deprecated
      manual `harvest.yml` workflow was deleted and the integration workflow now runs the harvest via
      `prefect_worker` after waiting for the Prefect deployment to register. **[verified fixed @ 6f64fb41]**
- [x] **The active branch has no CI.** Fixed for PRs: both integration and unit-test workflows now
      trigger on `main`, `master`, and `development*`, which covers `development-v2`; Python tests,
      the JS API/frontend smoke suite, and the download-request check now run through the integration
      workflow. **[verified fixed @ 6f64fb41]**
- [x] **`deploy.yml` is not gated on tests.** Fixed: `on:` is now `workflow_run` on **Integration
      Tests** (a superset — it runs the whole Python suite before compose) restricted to
      `master`/`development`, with `if: … workflow_run.conclusion == 'success'`, so the
      `workflow_run` expressions the file already used now resolve. Both test workflows gained a
      `push` trigger on those branches so the gate has a run to fire from, and the checkout pins
      `ref: workflow_run.head_sha` — a workflow_run checkout defaults to the DEFAULT branch, which
      would have deployed master's compose files to development. `workflow_dispatch` is unchanged
      and stays a deliberate manual override. **[fixed]**
- [x] CI now installs Node 22, matching `frontend/package.json` (`engines.node >= 22`) and
      `frontend/Dockerfile` (`node:22-alpine`). **[fixed]**
- [x] `build_and_test.yml` now uses `cp .env.sample .env`, `cp docker-compose.override.yaml.sample ...`,
      and `cp harvest_config.sample.yaml ...` during CI setup. **[verified fixed @ 6f64fb41]**
- [x] Action versions are current across all three workflows: `actions/checkout@v7`,
      `actions/setup-node@v7`, `astral-sh/setup-uv@v10.0.1`. `dorny/paths-filter` is gone with the
      old path-filtered unit workflow. **[verified]**

### Correctness bugs

- [x] **`download.js` assigns an undeclared global.** Already fixed before this pass — `count` is
      declared `let count = 0;` inside the handler. **[verified fixed]**
- [x] **`/download` never validates `email`.** Fixed: `errorHandler` (already exported by
      `validatorMiddlewares.js`) now runs after the `check("email")` in the chain, so
      `validationResult` is actually consulted and a bad address is a 400 instead of a row in
      `cde.download_jobs`. **[fixed]**
- [x] **Every download job carries a broken CKAN link.** Fixed to
      `'https://catalogue.cioos.ca/dataset/' || d.ckan_id AS ckan_url`, matching `shapeQuery.js`.
      Note the consumer disagreed about what the column meant: `download_erddap.py` re-appended
      `ckan_id` to it, i.e. treated `ckan_url` as a bare prefix while `shapeQuery.js` and the
      scheduler's email builder treat it as the full URL. `ckan_url` is now the full URL
      everywhere and the downloader uses it directly. **[fixed]**
- [x] **`redisFunctions.py` has an exception handler that always raises.** Fixed: the handler is
      `except requests.RequestException` logging through the Prefect run logger, the request has a
      timeout and a `raise_for_status()`, and the base URL is `CACHE_WARM_BASE_URL` (defaulting to
      the compose service `http://nginx:4000`). Discarding the body is intentional and now says so —
      the side effect of the request is the point. **[fixed]**
- [x] **Three loguru calls silently drop their arguments.** All three now carry `{}` placeholders,
      so the DB host, the PDF flag and the job id are actually logged. **[fixed]**
- [x] **`downloader` would fail a non-dev install.** `harvester` moved from `[dependency-groups].dev`
      to `[project].dependencies`; `uv.lock` regenerated (3-line diff). **[fixed]**
- [x] **`database/7_range_functions.sql` is dead but still executed.** Deleted — confirmed a strict
      subset of `8_range_functions.sql` by diff before removing. `database/README.md`'s file map no
      longer lists a `7_/8_` pair. **[fixed]**
- [x] **`/tiles/tracks` caches for 1 hour, not 5 minutes.** Now `cache.route()` like the other two
      tile routes, with a comment recording why the object argument was wrong. **[fixed]**
- [x] `preview.js` divide by zero. Already fixed before this pass — the expression is
      `CEIL(:NUM_RECORDS / nullif(records_per_day/24, 0))`, with a comment explaining the NULL
      path. **[verified fixed]**
- [x] `polygon.js` returns `false` on an invalid polygon and `dbFilter.js` never checked it.
      Fixed: `createDBFilter` throws `InvalidPolygonError` (`statusCode = 400`), which every route
      already propagates — they all have the `if (err.statusCode === 400)` branch for
      `ScientificNameSelectionTooBroadError`. **[fixed]**
- [x] `download_scheduler.py` builds its `UPDATE` by string interpolation. Converted to bound
      parameters; all four `.replace("%","").replace("'","")` sites are gone, so tracebacks and the
      downloader's JSON report are stored verbatim. Column names are still formatted in (they are
      module literals); a `SQL_NOW` sentinel keeps `time_start`/`time_complete` on the database
      clock rather than binding the string. Covered by `TestUpdateDownloadJobs` in
      `download_scheduler/tests/test_worker_loop.py`. **[fixed]**
- [x] `1_schema.sql` points at a `database/migrations/…` file that has never existed. Reference
      dropped; the note now just states the actual rule (this file is outside the `[3-9]_*.sql`
      migrate glob, so a live DB gets column changes by hand). **[fixed]**

### Correctness bugs — added 2026-09-09 **[2026-09-09]**

- [ ] **A transient ERDDAP failure makes the next incremental harvest delete the dataset.**
      `cde.skipped_datasets.erddap_url` is filled with `erddap.domain` — the bare hostname — at all
      four write sites (`sources/erddap/harvester.py:221,246,296,302`), while `cde.datasets` and
      every other temp table carry the full configured URL. `harvester.py:75-81` states the
      divergence outright and calls it "legacy compatibility"; what it misses is that the column is
      now load-bearing for pruning. `temp_skipped_datasets` is `LIKE cde.skipped_datasets`
      (`9_incremental_upsert.sql:34`), so `prune_stale_datasets` (`:415-431`) compares a hostname
      against a full URL in both the `covered` join and its `NOT EXISTS` guard. The guard therefore
      never matches, and a dataset that merely **errored** this run is indistinguishable from one the
      server no longer lists — so it is deleted, as long as the failure count stays under the 50%
      `max_fraction` circuit breaker. One flaky response is enough; the breaker only catches the case
      where *most* of a server fails.
      Fix: write `self.erddap_url.rstrip("/")` at those four sites — the `verified_rows` branch 6
      lines away (`:290-292`) already does exactly that — and backfill the hostnames already in
      `cde.skipped_datasets`. Note the rebuild-not-migrate policy in §P2.5 makes the backfill a
      re-harvest rather than a migration. **[verified]**

### Open question — RESOLVED

- [x] **`polygon.js` lat/lon order.** Resolved: **the names were wrong, the WKT was right.** The ring
      is produced by turf's `bboxPolygon` and mapbox-gl-draw (`Map.jsx` `setPolygon` is fed
      `geometry.coordinates[0]`) and serialized verbatim by `createSelectionQueryString`, all of
      which are GeoJSON-order `[lon, lat]`; the destructuring named it `[lat, lon]` but emitted the
      pair unswapped, which is the lon-first `X Y` that `ST_GeomFromText` wants. Spatial selections
      were never transposed. Names corrected, the invariant is documented in the module, and
      `web-api/utils/polygon.test.js` pins it with a ring whose two axes cannot be confused
      (lon ≈ -130, lat ≈ 50). Run by the new **Web API unit tests** CI job (`node --test`, no new
      dependency).

---

## P1 — Cheap, independent, safe — **first pass DONE except two deferred items** (2026-09-08)

The original survey's items are closed unless marked **[deferred]**. The two that remain —
`LICENSE` and the Python packaging consolidation — were scoped out deliberately: they are not
cheap, and each needs its own pass. The JS-style, ESLint-flat-config and Sentry items were
closed by the styling-unification pass; see that section and the verification at the end.

**Nine items added 2026-09-09** are open, in their own section at the end of P1. They are
independent of each other and of everything above.

### Ignore files & tracked junk

- [x] `.venv/` added (`venv` alone never matched it). `venv/` anchored as a directory too.
- [x] `.claude/` ignored. The three worktrees named in the survey are already gone; the
      remaining `settings.local.json` was ignored only by the developer's *global* git
      config, so it would have been committed from any other machine.
- [x] Env pattern tightened: `*.env` + `.env.*`, with negations for the four deliberately
      tracked files (`.env.sample`, `.env.coolify.sample`, `.env.production`,
      `frontend/.env.development`, plus `*/.env.sample`). Note the limit of this: gitignore
      does not protect a file that is already tracked, so it guards against a *new*
      `.env.local`/`.env.staging`, not against a literal edit to `.env.production`.
- [x] `harvest-prod/` ignored explicitly, so it no longer depends on the blanket `*.csv`.
- [x] `.pytest_cache/`, `.ruff_cache/` ignored. `downloads/` is a tracked mount point with a
      README, so it is `/downloads/*` + `!/downloads/README.md`, not a blanket ignore.
- [x] `frontend/.DS_Store` untracked (`git rm --cached`).
- [x] `downloader/.gitignore` added, matching the other two Python projects.

### Docker

- [x] **`.dockerignore` per build context** — added for `frontend`, `web-api`, `nginx` and
      `database`, and the root one rewritten. Measured context sizes after:
      root **3.8 GB → 32 kB**, frontend **529 MB → 3.1 MB**, web-api **104 MB → 4 kB**.
      The root file carries a syntax warning worth keeping in mind: `.dockerignore` is *not*
      `.gitignore` — a bare `node_modules` matches only the context root, which is how
      148 MB of `harvester/ckan_harvester_cache` survived the first rewrite. Depth patterns
      need an explicit `**/`.
- [x] **Host `node_modules` no longer copied over `npm ci`.** `frontend/Dockerfile` is fixed
      by its `.dockerignore`; `web-api/Dockerfile` now copies `package*.json`, runs
      `npm ci --omit=dev`, and only then copies source — so a source edit reuses the install
      layer, and `.env.sample` no longer lands in the image.
- [x] Root context drift fixed — see the measurement above.
- [x] **`SENTRY_AUTH_TOKEN` is a BuildKit secret**, not an ARG promoted to ENV. Mounted only
      for the `npm run build` layer that uploads source maps; `docker-compose.production.yaml`
      passes it via `build.secrets` from the deploy environment (needs Compose ≥ 2.23).
      Verified: the token appears in neither `docker inspect` env nor `docker history`.
- [x] **HEALTHCHECK** added to `web-api` (`/health`, a new liveness route — deliberately not
      a DB probe, since nginx gates on it), `frontend` and `nginx` (a local `/healthz` stub
      in `nginx.conf`, answered by nginx itself so an upstream 502 is not read as the proxy
      being dead). `redis` gets one in compose. `nginx`'s `depends_on` is now
      `condition: service_healthy` on both upstreams, which closes the 502 window on every
      deploy. All three verified reporting `healthy` in a live container run.
      **USER**: added to `web-api` (runs as `node`). Not added to `nginx` (cron + logrotate
      in `start.sh`; workers already drop to the `nginx` user) or to the two Python services
      (they own named volumes whose ownership is fixed at first creation — switching now
      would need a manual `chown` on every existing deployment). Both are commented in place.
- [x] Floating images pinned: `web-api` `node:alpine` → `node:22-alpine`, `frontend` stage 2
      `nginx` → `nginx:1.27.4-alpine`, `redis:alpine` → `redis:7.4-alpine`.
- [x] `harvester/Dockerfile`'s `|| uv lock && uv sync` fallback removed — it regenerated the
      lockfile mid-build, so the image could pin untested transitive versions and the final
      `--locked` would still pass. `download_scheduler/Dockerfile` gained `--locked`.
      *This immediately surfaced two stale lockfiles* (`downloader`, `download_scheduler`);
      both relocked. The `apt-get` half of that bullet was already fixed:
      `--no-install-recommends` and the list cleanup are both present.
- [x] `docker-compose.production.yaml` no longer publishes Postgres on `0.0.0.0`. The port is
      genuinely needed — the external harvester and any remote `prefect_worker` reach it over
      the VPN — so it binds `${DB_BIND_ADDRESS:-127.0.0.1}`, defaulting closed, with
      `DB_BIND_ADDRESS` set to the VPN address in `.env.production`.
- [x] `env_file: [.env]` collapsed to an `x-env-file` anchor across the four services. The
      differing `DB_HOST_EXTERNAL`/`REDIS_HOST` defaults are per-service on purpose and were
      left alone; restructuring the override files remains the `TODO.md` item.

### Tooling & gates

- [x] **Lint/build gate added.** A new `lint` job in the **Integration Tests** workflow —
      the workflow `deploy.yml` gates on — runs `ruff check`, `uv lock --check` across all
      four projects, `npm run lint` for web-api and frontend, and `npm run build` for the
      frontend. It is a separate fast job, so it fails the workflow (and blocks deploy)
      without waiting on the 45-minute compose job.
- [x] **`.pre-commit-config.yaml` added**: LF enforcement (matching `.gitattributes`),
      end-of-file/trailing-whitespace, large files, private keys, YAML/JSON, ruff, and
      `uv lock` for all four projects. Jinja2 `.j2` templates are excluded from the
      whitespace hooks — their whitespace is rendered email content. Runs clean and
      idempotent over the whole repo.
- [x] **Ruff config committed and applied.** `[tool.ruff]` in the root `pyproject.toml` only;
      ruff walks up to the nearest section, so it governs all three Python projects.
      `line-length = 120`, `select = ["E","W","F","I","UP","B","C4","LOG","DTZ","SIM","RUF100"]`.
      `G` (logging-f-string) is deliberately not selected: its 44 hits are loguru calls,
      where an f-string is the documented style. 224 findings → **0**; `ruff check` passes.
      Notable real fixes among them: two naive-datetime call sites (log filenames and the
      "ongoing dataset" end bound were built from local time while everything else is UTC),
      a bare `except:` around `pd.Timedelta`, two root-logger calls in `__main__.py`, six
      `zip()`s now `strict=True`, a mutable `skiprows=[1]` default, and the six stale `noqa`
      the survey called out. Three `# noqa: F841` remain with reasons — pandas `.query()`
      resolves `@name` out of the caller's locals, which ruff cannot see.
- [x] `web-api/.eslintrc.js` fixed: `env.node`/`sourceType: "script"` instead of
      `env.browser`/`"module"` for CommonJS Node code, and a `lint` script added next to
      `lint:fix`. 218 errors → **0** (28 `no-console` warnings remain, which are intentional
      — stdout is this service's log). Each airbnb rule relaxed is annotated with its reason
      in the config (snake_case DB columns, express `consistent-return`, `next` arity).
      Real fixes: six dead bindings, a `requiredShapeMiddleware(req,res,next)` that took
      three parameters it never used, eight `!= undefined` → `!== undefined`, and six
      redundant regex escapes (equivalence checked before removing).
      `frontend` lint: 503 → **0**, 500 by autofix across 14 files (the Harvest components,
      written in a different style) plus two dead bindings.
- [x] **Unified the two JS styles.** Prettier (defaults: double quotes, semicolons,
      2-space, 80 cols) now owns formatting for `frontend`, `web-api` and `test`, and both
      `.eslintrc` files are gone. `standard` and `airbnb-base` were dropped rather than
      ported — being eslintrc-only is exactly what pinned the repo to ESLint 8.
- [x] Root `test/` — already fixed by the CI refresh. **[verified fixed @ 6f64fb41]**
- [x] `CODEOWNER` → `CODEOWNERS`.
- [ ] **[deferred]** `LICENSE`. Not a cleanup decision: this repo is a fork of
      `HakaiInstitute/cde`, which has no licence of its own, and the `cioos-siooc` org uses
      five different ones across its repos. Being handled elsewhere.
- [x] `CONTRIBUTING.md` and `.github/dependabot.yml` added. Dependabot covers three npm
      projects, four uv projects, six Docker contexts and the GitHub Actions, grouped so a
      week's patches arrive as one PR per ecosystem.
- [x] **ESLint 8 → 9 flat config.** One root `eslint.config.mjs` scopes all three
      runtimes (browser ESM + JSX, Node CJS, Node ESM), which also picked up the two
      things nothing linted before: `test/` and `web-api/bin/www`. ESLint **9**.39.5, not
      10: `eslint-plugin-react@7.37.5` caps its peer at `^9.7` and has no v10 release.
      Revisit when it ships one.
    - The toolchain now lives in a root `package.json` (ESLint, Prettier, stylelint) —
      one install, one version, and `--ignore-path .gitignore` is gone. Neither Dockerfile
      is affected: each copies only its own manifest, and `web-api` already built with
      `--omit=dev`.
    - **stylelint added** (`stylelint.config.mjs`); CSS was entirely unlinted. ~300
      findings autofixed. It immediately found a live bug: `width: 60` (no unit) in
      `Controls/Filter/styles.css` is invalid CSS that browsers silently drop. Seven rules
      are off, each annotated with why.
    - **Prettier 3 reads `.gitignore` by default**, and the root `.gitignore` has a bare
      `harvest` pattern for build artifacts — so all 17 files under
      `frontend/src/components/Harvest/` were being silently skipped by the formatter.
      Both `format` scripts now pass `--ignore-path .prettierignore`.

### Dependencies

- [x] **Seven unused `web-api` dependencies dropped** — `@mapbox/sphericalmercator`,
      `cache-manager`, `ioredis`, `lru-cache`, `validator`, plus `prettier` and
      `eslint-config-prettier` (both of which were in production `dependencies`).
      `cookie-parser` went too, with the view scaffolding below.
- [x] Overlapping stacks collapsed as far as the dead code went: `ioredis` and `validator`
      are gone, leaving one Redis client and one validator. The `apicache`/`redis@5` shim in
      `utils/cache.js` stays — replacing `apicache` is a behaviour change, not a prune.
- [x] **Sentry majors.** `@sentry/node` 6.19.7 → 10.73.0 and `@sentry/tracing` deleted
      (folded into the SDK). The frontend needed **no** API changes — it was already v10
      and idiomatic, so the "four-major gap" was web-api alone. Init moved to
      `web-api/instrument.js`, required as the first statement of `bin/www`: v8+
      auto-instrumentation patches modules as they load, and the old code called
      `Sentry.init` at `app.js:45`, thirty lines after `require("express")`, so tracing
      could never attach. The three `Sentry.Handlers.*` calls collapse into one
      `Sentry.setupExpressErrorHandler(app)`. Note this pulls OpenTelemetry v2 into the
      image.
- [x] Stale `web-api` pins bumped: `dotenv` 10 → 17 (all six `config()` calls now pass
      `{ quiet: true }`; v17 prints a promo banner otherwise), `uuid` 8 → 11, `debug` 2.6.9
      → 4, `http-errors` 1.6 → 2. The express-generator remnants are gone: `views/`,
      `public/`, `cookie-parser` and the jade view engine. **This fixed a live bug** — see
      the note under Verification.
- [x] Three dead frontend dev deps removed (`eslint-config-airbnb-base`, `eslint-plugin-node`,
      `eslint-plugin-standard`), `eslint-plugin-n` added (it is `eslint-config-standard@17`'s
      real peer and was only resolving transitively), plus the dead `allowScripts` block and
      the empty `overrides`.
- [x] `@turf/*` 6.5 → 7.4 and `lodash` → `lodash-es`. `@turf/union` changed signature in v7
      (two features → one FeatureCollection); both call sites in `Map.jsx` updated, still
      folded pairwise so one degenerate fragment costs only itself.
- [ ] **[deferred]** Consolidate the Python packaging. Still four `.venv` and four `uv.lock`.
      All four locks are now current and CI checks them, which removes the acute risk
      (image and tested code resolving differently); merging them into one workspace is the
      structural item.
- [x] Python floors reconciled: `download_scheduler` and the root were unbounded `>=3.10`
      while harvester and downloader are `>=3.10,<3.11`, so the root lock carried
      3.11–3.13 markers no deployment can satisfy. All four are `>=3.10,<3.11` now.
      `downloader/pyproject.toml`'s pasted-in description fixed.
- [x] `download_scheduler` has a dev group with pytest 9 (it had three test suites and no
      pytest at all, so they only ran from the root workspace); `downloader`'s pytest 8
      raised to 9 to match harvester.

### Found while doing this — new items, not from the original survey

- [x] **`web-api` never initialises Sentry in production.** Fixed as part of the Sentry
      upgrade, deliberately: the gate is now `if (process.env.SENTRY_DSN)`, and the DSN is
      read from the environment instead of being hardcoded. **This enables error reporting
      that has never been on in production — expect a burst of previously-invisible errors
      on the first deploy.** The handler also moved after the 404 middleware; it sat before
      it, so nothing registered later could ever reach Sentry. Verified both ways locally:
      with a DSN the app boots and `/sentry-test` flows through the handler, without one it
      starts clean. The frontend DSN is deliberately left hardcoded — browser DSNs are
      public by design, and making it a build arg would risk a deploy contract that cannot
      be tested from here.
      Superseded detail: `app.js:46` gated on
      `process.env.ENVIRONMENT === "production"`, but `.env.production` sets
      `ENVIRONMENT=juno-cioos-co-production`. One-word fix, but it *enables* error reporting
      that is currently off, so it wants a deliberate decision rather than a drive-by.
- [x] **React hooks: all 16 rules of `eslint-plugin-react-hooks@7` are on.** The five that
      were off (`rules-of-hooks`, `exhaustive-deps`, `set-state-in-effect`, `refs`,
      `immutability`) reported 104 findings between them; all 104 are resolved.
      `exhaustive-deps` sits at `warn`, the rest at `error`.

      The three `rules-of-hooks` findings were the real bugs the original note suspected:
      `DatasetPreviewTable` called `useTranslation`/`useState` after an early return (the
      hook order changed whenever `datasetPreview` arrived), and
      `generateMultipleSelectBadgeTitle` called `useTranslation` from a plain function — it
      now takes `t` as a parameter, like its sibling `generateRangeSelectBadgeTitle`.

      Most of the rest were state that did not need to be state:
      - `utilities.useChanged(...values)` is the shared form of React's "adjust state when
        an input changes" — a render-phase update instead of an effect. It replaced 13
        mirror-into-state effects (the rail date/depth fields, the filter panel's
        controlled/uncontrolled sync, the download checkboxes, the sidebar reveals, the
        pager resets, the feature card).
      - Derived-during-render replaced more: the legend's zoom tier and the filter query
        (`MapStateProvider`, `FilterProvider`), the download submission's feedback, the
        preview table's row objects, `timeFilterActive`/`depthFilterActive`, and the
        ERDDAP server titles (which were being rewritten by an effect on every language
        change — now a memo over `i18n.language`).
      - `useMediaQuery` is a `useSyncExternalStore` now, which is what it always was.
      - `mapRef` became `mapInstance` state: `ZoomToDataset` was reading the ref during
        render, which is what the `refs` rule caught. `LegendFooter` no longer needs
        `mapLoaded` to notice the map arriving.
      - `useHarvestFetch(path, deps)` lost its unverifiable `deps` argument — every one of
        its 12 call sites passed exactly the values already interpolated into `path`.

      What is left is marked at each site with an `eslint-disable-next-line` and a reason:
      deliberate debounces, one-shot flags, fetch kickoffs, self-feeding effects, and —
      the bulk of them — `Map.jsx`'s imperative MapLibre effects, which are keyed on the
      state that should trigger them rather than on everything they read. See the note at
      the top of `Map.jsx`; making its helpers stable with `useCallback` is the follow-up
      that would remove those 16.

      One known bug is documented rather than fixed: the `/pointQuery` effect in
      `SelectionProvider` uses `selectionLoading` as a mutex and drops filter changes made
      while a query is in flight. Completing its dependency array would put it in a refetch
      loop; the fix is an `AbortController`/request id. It now has the entry this note
      promised — see the 2026-09-09 section at the end of P1.
- [x] `harvester/tests/unit/test_schema_rebuild.py::test_database_url_still_builds_when_complete`
      failed in a full-suite run but passed alone: the repo `.env`'s `DB_PORT=5433` leaked in
      via the `load_dotenv()` that `prefect_pipeline` runs at import time, so whichever test
      imported it first changed what every later test saw. Fixed with an autouse
      `isolate_db_env` fixture in `harvester/tests/conftest.py` that clears the five DB
      settings for every test — the suite now reads the same locally as it does in CI, where
      there is no `.env`. Every test that needs one of those settings already sets it itself.

### Styling unification (2026-09-08)

- [x] **Frontend CSS tokenised.** `Harvest/styles.css` was the only sheet with real
      hardcoded colour (78 values); the `ui/*.css` hits were all `var(--cioos-x, #fallback)`
      fallbacks, which are fine as they are. 39 values that matched a theme token became
      `var(--cioos-*)`, chosen per selector (`color` → `ink`, `background` → `navy`, status
      selectors → `success-bg`/`error-bg`). The other 39 had no global equivalent and are
      now 15 named locals on `.harvest-root` — they are admin status tints, not brand
      values, so they stay out of `theme.css`. Verified every `.harvest-*` element renders
      inside `.harvest-root`, including the early-return loading/error paths.
- [x] **Harvest inline styles moved into the stylesheet**, 114 → 33 across the repo. The
      subtree had 95 inline styles beside a 398-line sheet. Conditional colours became
      conditional classes rather than inline hex, so no hardcoded colour is left in any
      Harvest JSX. Seven near-identical font sizes (0.72–0.85rem) collapsed to a four-rung
      scale; the widest change moves text by about half a pixel.
      What stays inline is deliberate: `Legend.jsx` computes gradients and positions from
      data, `Spinner.jsx` sets a per-node `--cioos-node-delay`, and `IntroModal` /
      `DownloadDetails` build `backgroundImage` from a Vite asset import.
- [ ] `logo.jsx` still holds six static inline styles and has no stylesheet. Left alone:
      it is a self-contained brand component, not part of the half-migrated Harvest subtree.
- [x] **Sentry transactions now carry route names.** `reactRouterBrowserTracingIntegration`
      replaces the plain `browserTracingIntegration`, so `/harvest/run/run-abc-123` reports as
      `/harvest/run/:runId` with `transaction_info.source: route` instead of `url` — the six
      parameterised routes no longer split into one transaction per id. (The `…V6…` spelling of
      both helpers is deprecated in @sentry/react 10; the version-agnostic pair is used instead,
      which differs only in the span `origin` label.)
      `Sentry.init` moved out of `App.jsx` (a *route element*) into `src/sentry.js`, which also
      exports the wrapped `SentryRoutes`. That pairing is not cosmetic: the wrapper reads the
      router hooks the integration captures during `init` and, if it runs first, returns an
      unwrapped `<Routes>` **silently** — no error, just raw URLs again. Keeping both in one
      module makes that ordering unbreakable rather than a property of import order.
- [x] **Frontend Sentry DSN is configuration, not a literal.** It comes from `SENTRY_DSN`
      (vite `define` → Docker build arg → base compose, which is the file Coolify deploys
      from), and it is also the on/off switch: `enabled: Boolean(dsn)`, matching how
      `web-api/instrument.js` gates on the same variable. One value now covers both services.
      Two asymmetries this creates, both documented where they bite: web-api reads it at
      **runtime**, the frontend at **build time**, so changing it needs a frontend rebuild; and
      because vite bakes it into the JS bundle, the value is **public** to anyone loading the
      site. That is normal for a browser DSN, but it is now also true of the DSN web-api uses —
      a DSN permits sending events to the project, so the exposure is quota/noise abuse, not
      data access. Kept as a plain build ARG rather than a BuildKit secret for that reason:
      hiding it from `docker history` would hide it nowhere else.
      **Deploy action required:** no fallback is baked in, so `SENTRY_DSN` must be set wherever
      the frontend image is built or browser error reporting stays off. The value the bundle
      used to hardcode is
      `https://ccb1d8806b1c42cb83ef83040dc0d7c0@o56764.ingest.sentry.io/5863595`.
      Noted while moving it: the old comment claimed the SDK is initialised everywhere so the
      feedback dialog works locally. It never was — with no DSN (previously `enabled: false`)
      `Client.init()` skips integration setup entirely, so `getFeedback()` is `undefined` and
      the dialog cannot open. Comment corrected; `captureException` stays safe either way.

### Verification for the 2026-09-08 sweep

- `ruff check .` — clean (was 224).
- `uv run pytest -m "not integration"` — 535 passed, 6 skipped; the one failure above is
  pre-existing and reproduces identically on the pre-change tree.
- `uv lock --check` — clean in all four projects.
- `npm run lint` — clean in `web-api` (0 errors) and `frontend` (0).
- `npm test` in `web-api`, `npm run build` in `frontend` — both pass.
- `uvx pre-commit run --all-files` — passes, and is idempotent on a second run.
- All six images build, including the frontend with the BuildKit secret. `web-api`, `nginx`
  and `frontend` verified reaching `healthy` in a live run, with nginx proxying
  `/api/health` through to web-api.
- **Live bug fixed in passing:** `jade` was never in `web-api/package.json`, so `res.render()`
  threw — `GET /` and *every* 404 and 500 fell through to express's default handler, which
  answered **500 with the full stack trace in the response body**. Routes and the error
  handler now return JSON, and `NODE_ENV=production` in the Dockerfile keeps the stack out
  of the response (express defaults to `development` when it is unset, which the container
  never set).

### Second audit pass — download, scheduler and viewport **[2026-09-09]**

Nine items from the GPT Sol 5.6 pass. All verified against the working tree; none depends on
another. The four download-pipeline items (`over_limit`, the OBIS budget, the lease, the email
isolation) touch the same two files and are cheapest taken as one sitting.

- [ ] **Short download IDs collide, and a collision serves one user's data to another.**
      `download.js:178` mints the id as `uuidv4().substr(0, 6)` — 24 bits, 16.7 M values, so the
      birthday bound puts a first collision at ~50% by about 4,800 jobs. `download_jobs.job_id` is
      plain `text` with no unique constraint (`1_schema.sql:541`), and the id is the *only* thing
      naming the artifact: `downloader_wrapper.py:9` derives the temp folder from it and
      `download_scheduler.py:220` derives `cde_download_<job_id>.zip`, which is what
      `:155` emails as `DOWNLOAD_WAF_URL/<zip_filename>`. So a collision silently overwrites the
      earlier archive, and the first user's emailed link then downloads the second user's data. The
      24-bit space is also small enough to enumerate against `/downloads/` directly (nginx has
      `autoindex off`, but a direct URL still serves).
      Fix: store the full `uuidv4()`, add `UNIQUE` on `job_id`, and prefer a separate unguessable
      token for the public filename so the job identifier is not also the capability. **[verified]**
- [ ] **OBIS downloads bypass both size limits entirely.** `download_erddap.py:277` runs
      `duckdb.sql(query).df()`, materialising the whole parquet result in memory with no budget, and
      `:344-345` hardcodes `dataset_limit_hit`/`query_limit_hit` to `False`. `get_datasets` then
      `continue`s at `:414` before reaching any of the checks the ERDDAP path runs at `:467-470` and
      `:509-513`, so neither the 1 GB per-dataset nor the 5 GB per-query limit applies to an OBIS
      dataset. Fix: stream the DuckDB result instead of calling `.df()`, and charge its bytes to the
      same cumulative budget. **[verified]**
- [ ] **`report["over_limit"]` is never assigned, so a truncated download is emailed as complete.**
      It is initialised `False` at `download_erddap.py:379` and written nowhere in the repo — the
      per-dataset `dataset_limit_hit`/`query_limit_hit` at `:596-597` are computed but never
      aggregated. `download_scheduler.py:271` is the only reader, so the `over-limit` status and its
      email template (`:162,179`) are unreachable: a job that hit `PARTIAL` at `:515-518` or skipped
      datasets as `IGNORED` at `:469` is reported as having completed successfully.
      Second bug in the same place: the antimeridian loop at `:450` reassigns `download_status`, so a
      later region's `IGNORED` overwrites an earlier region's `PARTIAL` — the more informative
      outcome loses. Fix: set the aggregate flag wherever either budget is hit, and rank the
      per-dataset statuses instead of overwriting. **[verified]**
- [ ] **An interrupted download job is unclaimable forever.** `get_a_download_job()`
      (`download_scheduler.py:70-92`) flips `open` → `downloading` and commits, with no lease and no
      attempt count, and `__main__.py:12-16` is a bare `while True` with no startup recovery. An OOM,
      a deploy, or a `docker kill` mid-download strands the row in `downloading` permanently: the
      `status='open'` predicate never sees it again and the user is never emailed. The
      `FOR UPDATE SKIP LOCKED` protects against two live workers, not against a worker that dies.
      Fix: model the claim as a lease (`claimed_at` + attempts) and requeue expired claims, which
      also gives the retry ceiling the current design has no place for. **[verified]**
- [ ] **An SMTP failure rewrites a successful download as failed.** `run_download` commits the
      completed row at `:288-298` and *then* calls `email_user` at `:300-306`. `send_email`
      (`download_email.py:31-40`) only catches `SMTPAuthenticationError`, so every other SMTP failure
      — connect, TLS, recipient refused, timeout — propagates out of `run_download`, is caught by
      `process_next_job`'s blanket handler at `:439-449`, and `fail_job` overwrites the row with
      `failed` plus a mail traceback. The archive exists and is downloadable; the record says the job
      failed. Fix: separate notification delivery from the download outcome — the status is already
      committed, so the mail failure belongs in its own retry/record, not in the job status.
      **[verified]**
- [ ] **A filter or polygon change during an in-flight `/pointQuery` is dropped and never retried.**
      `SelectionProvider.jsx:519` guards on `!selectionLoading`, but `selectionLoading` is
      deliberately absent from the dependency array, so nothing re-runs the effect when the load
      finishes — the change is lost until some other dependency happens to change. This is the bug
      the React-hooks item above documents rather than fixes; this is the entry it points to, and the
      `KNOWN LIMITATION (tracked separately)` comment at `:511-517` should name this section.
      Fix: drop the mutex and discard stale responses with an `AbortController` or a request
      generation id — completing the dependency array alone would put it in a refetch loop.
      **[verified]**
- [ ] **Oversized trajectory responses skip the documented chunked fallback.** `client.py:342-348`
      raises `ResponseTooLargeError` (`core/errors.py:22`, a bare `Exception` subclass — *not* an
      `HTTPError`), but all four fallback handlers in `trajectory_features.py` catch `HTTPError`
      only: `:206` (the chunk loop), `:515` (finer track interval), `:520` (server-side track
      grouping) and `:648` (server-side day grouping). So a grouped query that is merely too large
      either suppresses track extraction or fails the whole dataset, instead of taking the chunked
      path those two handlers' own log messages promise (`:521-524`, `:649-652` — "falling back to
      chunked download"). `:206` has the same gap from the other side: an oversized *chunk* is fatal
      rather than subdivided. Fix: catch both exceptions at all
      four sites, and halve an oversized chunk rather than skipping it. **[verified]**
- [ ] **A stale WMS image can overwrite the current viewport.** `renderWmsImage` captures
      `wmsRenderToken.current` at `Map.jsx:1812` and re-checks it in `img.onload` at `:1816`, but the
      token is only incremented in `removeWmsOverlay` (`:1754`). Two renders of the *same* overlay —
      which is the normal case: `:1983` re-renders on a debounced `moveend` — therefore share one
      token, so an earlier GetMap that resolves after a newer pan passes the check and paints its
      stale bounds. One-line fix: increment the token at the top of `renderWmsImage` and capture the
      new value. Related but separate from §P2.6's guard inventory, which counts this ref as one of
      the five ad-hoc idempotence guards. **[verified]**
- [ ] **Generated archives have no retention policy.** `downloader_wrapper.py:32-40` writes each ZIP
      into the `downloads` volume (`docker-compose.yaml:174`, served read-only by nginx at `:122` and
      `nginx.conf:62-68`), and nothing in the repo ever removes one — no cron, no TTL, no cleanup on
      job completion. Multi-gigabyte jobs accumulate until the volume fills, at which point every
      download fails; the short guessable ids above make the growing pile publicly addressable too.
      Fix: expire archives and their `download_jobs` rows together on a TTL. Needs a retention
      decision (how long is a link good for?) before it can be implemented, which is the only reason
      this is not a one-sitting item. **[verified]**

---

## P2 — Structural (the deepening candidates)

Each of these is a larger piece of work. See the HTML review for before/after diagrams.
**Do not start these until P0's CI items are done.**

### P2.1 — One module owns what a selection is — **DONE** (2026-09-09)

`web-api/utils/selection.js` and `utils/hexTiers.js` (new), `utils/{dbFilter,shapeQuery,hexMetric}.js`,
`routes/{tiles,legend,timeExtent,download,griddapCoverage}.js`

- [x] **The gates now have one owner.** `utils/selection.js` exports `erddapVisible(query)` and
      `obisVisible(query)` — the two predicates that were written out **eight** and **six** times
      respectively, verbatim, across five files. Every route asks; none answers for itself.
- [x] **What was left of the branch-set duplication, likewise.** `TRAJECTORY_COVERAGE_FROM` (three
      copies), `GRIDDAP_FROM` + `GRIDDAP_TIME_DEPTH_COLUMNS` (two), and `unionBranches()` — the
      UNION-ALL-plus-empty-guard idiom, six copies of a subtle four-liner. The **projections stay
      with the routes**: each selects the columns its own query needs, and forcing those through a
      shared shape would have been a parameter list as long as the thing it replaced.
- [x] **`show_as_point` resolved in favour of the selection.** It is a *display* flag — the harvester
      (`dataset_types/geo.py`) sets it false for a feature whose bbox has no meaningful single point,
      which is "still searchable via the stored bbox". So the map keeps it (`/tiles`, `/tiles/cells`,
      `/legend`, now via the named `DRAWN_AS_POINT` so its absence elsewhere reads as deliberate) and
      **`/timeExtent` drops it**, joining the shape query and `/download`. The time axis now spans the
      same features as the dataset list it bounds. *This is the pass's one behaviour change:* the
      slider's axis can widen on a selection holding region-spanning features.
- [x] **Hex tiers.** `utils/hexTiers.js` owns the two grids and the four names the schema gives each
      one (tier number, `cde.hexes_zoom_*`, `hex_*_pk`, edge length) plus `tierForZoom(z)`. That
      replaces seven encodings across five files, including `tiles.js`'s `250000 / 25000` prefilter
      constants (now `edgeMetres * 2.5`). `database/4_create_hexes.sql` still spells the two edge
      lengths independently — JS cannot share a constant with it — so hexTiers.js cross-references it
      and says changing one means changing both and re-tiling.
- [x] `hasObisOnly` / `hasProfileOnly` deleted from `dbFilter.js` (zero consumers). `hasShared` stays,
      with a comment saying why it is the only one anybody needs: it gates an *outer* WHERE that is
      dropped entirely when nothing narrows it, where the other two land inside a branch's own WHERE
      and "TRUE" is the right answer.
- [x] `hexMetric.js`'s `nullMetricExpr` deleted: the legend's coverage guard used to spell out a
      typed NULL shell whose column names and types had to be kept in step with the real branch by
      hand. It now wraps the real branch, like the other five guards, so it cannot fall out of sync.
- [x] **The drift now has a gate.** `utils/selectionAgreement.test.js` drives each route's handler
      with `../db` stubbed by a builder-only knex that captures SQL instead of executing, and asserts
      the cross-route rules: same gate everywhere, every `cde.profiles` branch binds the
      feature-level EOV filter, only the map routes restrict to `show_as_point`, trajectory coverage
      read at one tier outside the map, and an empty selection still yields runnable SQL. Verified by
      mutation — reinstating `show_as_point` in `/timeExtent`, pointing `/download` at the coarse
      tier, dropping a gate or an EOV filter each turn it red. Plus `selection.test.js` (10) and
      `hexTiers.test.js` (4). **68 pass**, up from 47.
- [x] **Behaviour-preservation proof.** A throwaway harness captured every statement all six routes
      emit across 15 selections x 4 zooms — 995 statements — before and after. **955 byte-identical
      modulo whitespace**; the 40 that differ are exactly three intended groups: 26 the griddap arm
      gaining the table alias `d` (`FROM cde.datasets d`, same statement), 13 `/timeExtent` losing
      `show_as_point`, 1 the legend's empty coverage guard. The trajectory/profiles/obis branch set
      itself is unchanged in every one of the 995.

### P2.2 — Accept the database, don't construct it — **DONE, SCOPED DOWN** (2026-09-08)

`web-api/db.js`, `bin/www`, `utils/{dbFilter,shapeQuery,redis,cache}.js`, `routes/nonna.js`

**The premise was measured and is largely false, so the route-wide DI target was rejected.**
With every `DB_*`/`REDIS_*` var unset and no Postgres or Redis running, `require("./app")` — all
21 routers, both filter utils, redis and cache — returns in 1.6 s and opens **zero** connections:
knex does not connect at construction, only when a query executes. What was actually fused, and is
now split, was two specific call sites.

- [x] **`db.js:13` "opens a pool" — it does not.** knex is lazy; the only observable import side
      effect was `db.js:16` logging `Connected to DB: undefined undefined undefined`, i.e. a line
      that claimed a connection that had not happened and printed nothing useful without env. It is
      deleted, with a comment saying why, and `bin/www` now logs the *target*
      (`DB target: host/name:port`) once at startup instead. Requiring a util is silent.
- [x] **"~95% cannot run without a live Postgres" — it already could.** `createDBFilter` resolves
      with no database and its predicates were already assertable via `.toString()`. The returned
      `db.raw(...)` objects need a knex *instance*, not a live Postgres — and a builder-only
      `knex({client:"pg"})` is exactly that. Pinned by `utils/rawBindings.test.js`, which records
      the previously undocumented contract those six call sites rely on: a `Raw` carries its own SQL
      and nested bindings, so it interpolates correctly into a *different* instance's `db.raw`.
      That is why the objects were kept rather than flattened to strings — flattening moves
      parameter merging into `shapeQuery`, `griddapCoverage`, `tiles`, `legend`, `download` and
      `timeExtent` for no gain.
- [x] **The two genuinely fused seams, now split.** `shapeQuery.js` gained
      `buildShapeSql(query, {doEstimate, getRecordsList, fetchAphiaIds})` returning `{sql, params}`;
      `getShapeQuery` is that plus `db.raw` and is unchanged for its three callers. `dbFilter.js`'s
      aphia-expansion — the *only* query the module ran, and the reason it is async — takes an
      injectable `fetchAphiaIds`, defaulting to the live one. Verified behaviour-preserving by
      comparing against the pre-change module across a 20-selection matrix: **SQL and bindings
      byte-identical in all 20**, including every branch combination and both option flags. The
      expansion SQL was hoisted to a module constant, also byte-identical by diff.
- [x] **`cache.js`'s silent degradation was the real bug here, and is fixed.** It memoized the init
      promise *including its failure*, so one Redis blip at startup pinned the process to apicache's
      per-process in-memory store for its entire lifetime behind a single `console.warn` — the
      retry could never happen. The connect lifecycle (single-flight, 2 s timeout, 60 s retry
      window) moved into `utils/redis.js`, which owns the client, and `routes/nonna.js` — which had
      its own parallel copy and a comment apologising for racing `cache.js` on the same client —
      now calls it. One owner, one promise, one retry window; only the successful adapter install
      is memoized, and the warn is now an `error`. Verified live: against real Redis the adapter
      installs and round-trips; against a dead port `ensureConnected` returns null in 2005 ms
      (bounded, does not throw, cache still serves) and the second call inside the window costs
      0 ms.
- [x] `utils/redis.js` is still a module-level client rather than a factory — deliberately. The
      testability complaint behind that bullet was that only one of `cache.js`'s two branches was
      reachable per process; `createCache({ redis })` fixes that (the module surface stays exactly
      `route` for all 29 call sites across 17 routes), and `utils/cache.test.js` drives success, failure **and
      the retry** in one process.
- [x] **REJECTED — `db.js` as a factory, `(deps) => router` across the 20 route modules,
      `createApp({db, cache})`, "two adapters".** ~24 files touched during an intensive development
      phase to buy something already available. It would also not be the clean seam it sounds like:
      `require("pg-parse-float")(pg)` (`db.js:3`) and `apicache.options()` (`cache.js:68`) mutate
      process-global state and must run exactly once regardless of how many "adapters" exist.
      Recorded here rather than as an ADR because there is no `docs/adr/` in this repo and P0/P1
      record their decisions inline; if a `docs/adr/` is ever created, this belongs in it.
- [x] Tests added, all hermetic (`node --test`, no new dependency, and the existing
      `utils/**/*.test.js` glob already covers them): `dbFilter.test.js` (14),
      `shapeQuery.test.js` (13, two of them **characterisation** tests pinning the §P2.1 drift so
      whoever unifies the branch set can see exactly which queries change), `cache.test.js` (5) and
      `rawBindings.test.js` (4). **38 pass**, up from 3.
- [x] Handed to §P2.1 and done there: `dbFilter.js`'s consumer-less `hasObisOnly` / `hasProfileOnly`
      are deleted, and the branch set has one owner. The two characterisation tests
      `shapeQuery.test.js` carried for it now assert the agreed contract instead.

### P2.3 — Every route through the same shape — **DONE** (2026-09-08)

`web-api/utils/routePipeline.js` (was `validatorMiddlewares.js`), `utils/dataTypes.js`,
`routes/*.js`, `app.js`

- [x] **One assembly point, one stage order.** `utils/validatorMiddlewares.js` is now
      `utils/routePipeline.js`, and `pipeline({filters, shape, tileParams, checks, cacheFor})`
      returns the whole chain: validate → reject → cache → handler. Every route that had a
      validator or a cache stage registers `...pipeline(...)` instead of hand-assembling one, so
      the order cannot drift again. **The cache moved last on purpose**: apicache caches every
      status code unless told otherwise, so `/legend` and `/timeExtent` registering it first meant
      a 400 was stored under the request's key and replayed from there.
- [x] **The eight never-validated params are validated.** `includeObis` / `includeTrajectory` are
      `true|false`; `metric` is checked against `METRICS` (a *present* but unknown value is now a
      400 rather than a silent fall back to `records`, which the caller could not detect);
      `profileTypes` / `trajectoryTypes` are matched against the fixed cdm_data_type vocabulary,
      with **empty accepted** — `profileTypes=` is how the map says "none of that geometry", which
      is not the same as the param being absent. `platforms`, `obisNodes` and `erddapServers` are
      length-capped only: their values are free text handed back by `/platforms`, `/obisNodes` and
      `/erddapServers` verbatim (node titles, ERDDAP URLs), and all three are bound, never
      interpolated — so size is the only thing worth bounding.
- [x] **Route `:params` are validated.** `tileParamValidators` rejects a non-integer or
      out-of-grid `z/x/y` — `GET /tiles/abc/1/1.mvt` was a 500 from `ST_TileEnvelope(NaN)` and is
      now a 400. `/nonna` had its own copy of exactly this check; it now calls the shared one with
      its lower `maxZoom`.
- [x] `/pointQuery`, `/downloadEstimate` and `/griddapCoverage` take the full filter set and had
      **no validation at all** (the stale comment claimed otherwise). All three go through
      `pipeline()` now.
- [x] `requiredShapeMiddleware`'s module-level `router` is gone — `pipeline()` returns a fresh
      array on every call, pinned by a test.
- [x] **One failure mode.** The `statusCode === 400` re-shaping block (ten copies), the two
      `console.error` + 500 blocks, the eight `catch (err) { next(err) }` wrappers and
      `/download`'s **404-on-DB-error** are all deleted. Routes throw;
      `express-async-errors` (already required first in `app.js`) forwards it; `app.js`'s handler
      reads `err.statusCode || err.status || 500` and logs 5xx. Verified by probe that a 2-arity
      `async (req, res)` handler's rejection reaches the handler with no unhandled rejection —
      the "Express 4 leaves this unhandled, it kills the process" comments in `legend.js` and
      `timeExtent.js` predated that require and were no longer true.
- [x] **`/tiles/tracks` no longer hand-picks six filter keys.** It now passes the whole query to
      `createDBFilter` minus `depthMin`/`depthMax`/`pointPKs` — the only two fragments
      `cde.trajectory_track_stats` has no column to answer — and its `cand` CTE exposes the track's
      summary `bbox` as `search_geom` plus the dataset columns the filter references (the same
      aliasing trick `griddapCoverage.js` already uses), so **the polygon and the lat/lon rectangle
      apply where they were silently dropped**. `scientificNames` (and an OBIS-node-only selection)
      now hides the layer wholesale like every other ERDDAP branch, instead of leaving every track
      drawn over an OBIS-only map. Verified live: a rectangle over the South Pacific returns an
      empty tile where the unfiltered one is 633 kB, one over Nova Scotia 561 kB.
- [x] **Not a defect: `eovs` at dataset level here is deliberate.** `dbFilter.js:117-122` already
      records why — track stats cannot answer a feature-level EOV, so it stays dataset-level along
      with obis_cells, trajectory cells and the griddap pseudo-branch. Unchanged.
- [x] The cdm_data_type vocabulary and its comma-list parsing moved out of `tiles.js` into
      `utils/dataTypes.js`, because the validator needs the same set the branch SQL inlines from.
- [x] Tests: `utils/routePipeline.test.js` (9) — stage order, the fresh-array guarantee, each
      newly-validated param, tile coordinates, the empty-type-list selection, and the
      throw-with-`statusCode` contract. **47 pass**, up from 38.

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

> **Deliberate policy for now (recorded 2026-09-08) — do not raise versioned migrations again
> until this changes.** The project is in an intensive development phase and the active database is
> **not** treated as an important asset. A schema change is handled by rebuilding and re-harvesting,
> not by migrating, and that is the accepted cost of keeping maintenance minimal. Migrating a
> production database is expected eventually, but there is no production database to migrate yet.
>
> The mechanism for this already exists — use it rather than building another:
> `rebuild_schema()` in `harvester/cde_harvester/core/schema.py:206-238` runs in **one**
> transaction with `SET lock_timeout = '30s'`, does `DROP SCHEMA IF EXISTS cde CASCADE`, then
> applies `1_schema.sql` followed by the `[3-9]_*.sql` files sorted by *numeric* prefix (so unlike
> the compose glob it would order a future `10_` correctly), resetting `search_path` before each
> file to reproduce psql's per-file isolation. It is exposed as the on-demand Prefect deployment
> `cde-rebuild-database` (`prefect_pipeline.py:693,734,744`), which can re-trigger the harvest
> afterwards, and requires the caller to type the database name to confirm. `recreate_database.sh`
> is the local drop-the-volume path. Covered by `harvester/tests/unit/test_schema_rebuild.py` and
> `test_schema_drift.py`.
>
> **Consequently deferred:** a schema-version table, a real migration tool, per-file transactions
> and rollback. **Still worth fixing regardless of the policy**, because each bites a *development*
> database or a deploy today: the `[3-9]` glob silently skipping a future `10_*.sql`, the
> availability window below, the unqualified `search_path` in `3_`–`9_`, and `remove_all_data()`
> truncating `hexes_zoom_0/1` against the stated stable-pk invariant.

- [ ] Two disjoint mechanisms, neither versioned: initdb (fresh volume only) and the `db_migrate`
      one-shot globbing `/database/[3-9]_*.sql` on every deploy. No version table, no transaction
      across files, no rollback — nothing can tell you which state a database is in.
- [ ] `1_schema.sql` is not idempotent (`CREATE schema cde;`, plus `DROP TABLE IF EXISTS` ×18) and is
      deliberately excluded from the glob, so schema change means "drop the volume and re-harvest"
      (`database/README.md:7-9`, `recreate_database.sh`).
- [ ] The `[3-9]` single-character class silently skips a future `10_*.sql`. Two files already share
      the `7_` prefix. **[verified]**
- [ ] **A live availability window on every deploy**: `8_range_functions.sql:63` drops
      `day_union_days(daterange[])` and recreates it at :64-110, and `psql -f` gives each statement
      its own transaction (`db_migrate` passes no `--single-transaction`, and the file has no
      top-level `BEGIN`). Any `/legend` or `/tiles?metric=days` request in that gap fails. The same
      DROP-then-CREATE shape appears three more times in the file (`:15`, `:27`, `:135`) and twice
      in `5_profile_process.sql` (`:159-161`, `:364-365`). **[verified — the survey named this
      `cde.day_union_count` at `:67-68`/`:120`; the function is `day_union_days`, is declared
      unqualified with no `cde.` prefix, and the lines were wrong]**
- [ ] `remove_all_data()` truncates `hexes_zoom_0/1`, destroying the "hex pks are stable forever"
      invariant asserted at `1_schema.sql:13-19`.
- [ ] Unqualified `CREATE OR REPLACE FUNCTION` in `3_`–`9_`: `1_schema.sql:11`'s `SET search_path` is
      session-scoped and does not carry into separate `psql` invocations, and `db_migrate` never sets it.

### P2.6 — Give `Map.jsx` a seam that isn't WebGL `[Strong]` — *largest prize, largest risk*

`frontend/src/components/Map/Map.jsx` — 4338 lines, one default export

> **Re-verified 2026-09-10 against `fix/p0-cleanup-backlog @ 8f5f36e1`.** References below are
> anchored by **symbol name**, not line number: the 2026-09-09 pass refreshed every offset and they
> had all drifted again by +11 to +18 within a day, while *every function span was byte-for-byte
> unchanged*. Line numbers are given only where a symbol does not identify the site.
>
> **Prerequisite — now partly satisfied.** The four-layer suite is merged (PR #143): `vitest run`
> at `frontend/package.json:51`, 12 test files, `playwright.config.js`, and — the part that matters
> here — `vite.config.mjs` already aliases `maplibre-gl` to `src/test/stubs/maplibre.js`, which is
> the harness a seam module needs.
>
> **But there is still no behavioural gate on map interaction, so steps 3–4 stay gated.** The e2e
> suite asserts only that the map *paints*: `e2e/specs/smoke.spec.js:7` and `mobile.spec.js:13`
> check `map-container` is visible, `visual.spec.js:22` **hides the WebGL canvas** in every shot
> (`.maplibregl-canvas{visibility:hidden!important}`), and `axeBaseline.js:29` excludes
> `.maplibregl-canvas-container`. Nothing anywhere clicks or hovers the canvas; there is no
> `FeatureCard` assertion in the repo. Hover/click ranking — precisely what step 3 moves — has no
> regression net. Steps 1–2 are pure functions under vitest and are unblocked today.

- [ ] 22 `useEffect`, 42 `useRef`, **3** `useState`, 32 props, 22 `addLayer`. **~1900 lines sit
      behind a live WebGL context.** The mount effect alone is 1749 lines (2371–4119).
      **[re-verified 2026-09-10 — `useState` was 2, now 3; the other four are exact]**
- [ ] The render body monkey-patches MapboxDraw's mode table (393–478, plus 79–81 at module scope)
      and allocates a fresh `MapboxDraw` (640) and `Popup` (978) on **every render**, plus eight ref
      writes during render (`rangeLevelsRef`, `onViewportHexRangeRef`, `selectedTrajectoryRef`,
      `setColorStopsRef`, `mapQueryRef`, `onFeatureQueryRef`, `onMarkerClickRef`, `onTrackClickRef`).
      **[re-verified — still eight, one substitution: `selectedTrajectoryRef` is new]**
- [ ] **Twin maths kept in step by hand**: `radiusExpression` builds a MapLibre expression and
      `pointRadiusFor` re-implements the same arithmetic in JS. The test that would keep them honest
      cannot be written — neither is exported, and `pointRadiusFor` reads `pointRadiusRange.current`
      from closure rather than taking it as an argument. They agree today (both clamp outside the
      domain; the comment above `pointRadiusFor` says why), which is exactly the state that rots
      silently. Note they only *need* to agree at `padding = 0`: `radiusExpression` takes a padding
      the JS twin has no parameter for, and the `points` layer that `isOnAPointIn` hit-tests is the
      `padding = 0` entry in `POINT_LAYERS`. **[re-verified]**
- [ ] Re-entrancy is held by **five ad-hoc idempotence guards** (`appliedFocus`,
      `trackFocusApplied`, `appliedTrailRef`, `wmsRenderToken`, `lastClickHandledAt` — a plain
      `let`, not a ref), each documented as fixing one loop or flicker. One of them is also wrong
      today: `wmsRenderToken` is bumped only on overlay removal (`removeWmsOverlay`), so it does not
      discard a stale same-overlay render — a one-line fix, filed in P1 (2026-09-09) so it is not
      blocked behind this section. **Still unfixed as of 2026-09-10.** The survey named eight:
      `hexesRevealed` is now `dataRevealed`, `rampMeasuredForPk` is now `rampMeasuredFor`, and
      `hexRangeDirty` is gone entirely. **[re-verified — all seven refs present]**
- [x] Pure but unexported, so untestable: **`buildTileSuffix` and `griddapOutranksHexesIn` are done**
      — see step 1 below. Still inside `Map.jsx`: `filterTimeWindow` (16 lines — the obvious
      co-mover into `tileQuery.js`, it parses the same query string), `tracksTimeWindow` (11),
      `rampExpression` (5), `featureHasDataset` (7), `dedupeGriddapByPk` (8), `datasetPksOf` (8),
      and the dedupe/role/bbox rules inside `buildFeatureQuery` (208).
      **[re-verified — every span byte-identical to the 2026-09-09 pass]**
- [ ] **The seam is the hit-test group, and it is three map methods wide.** `isOnAPointIn`,
      `trackFeatureIn`, `griddapCoveredIn`, `datasetPksOf`, `trackItemsIn`
      and `buildFeatureQuery` are ~280 lines of array-of-feature ranking and dedupe buried inside the
      mount effect. Their dependency on MapLibre is `map.current.getZoom()`,
      `map.current.project(lngLat)` — **and `map.current.queryRenderedFeatures` (`:3610`)**, the
      re-query that pulls every rendered fragment sharing a hex's `pk` so the turf union can rebuild
      the cell from its MVT slivers. That third method is materially heavier to stub than the two
      arithmetic ones: it reads the live tile cache. So either the seam takes it as a third injected
      function — `(hits, { zoom, project, queryRendered })`, whose stub is a canned fragment array —
      or the fragment-union block stays in `Map.jsx` and only the ranking/dedupe rules move, which is
      where the untested logic actually lives. **Decide this before moving anything.**
      **[corrected 2026-09-10 — the 2026-09-09 pass claimed the *entire* MapLibre dependency was two
      methods and missed `queryRenderedFeatures`]**
- [ ] **`buildFeatureQuery`'s event coupling is already gone in practice.** It is declared
      `(e, hits)` but reads only `e.lngLat` (`:3765`), and the second of its two call sites (`:4102`)
      *already* fabricates `{ lngLat: { lng, lat } }` from a bare coordinate pair. Narrowing the
      signature to `(lngLat, hits)` is a no-behaviour-change diff at both call sites, and it is worth
      doing *before* the risky move rather than as part of it. **[new 2026-09-10]**
- [ ] `setColorStops` (106 lines) has **four entry points** — the `[rangeLevels,
      coverageRangeLevels]` effect, the `load` handler, a `zoomend` listener, and
      `refreshViewportHexRange` via `setColorStopsRef`. **[re-verified]**
- [ ] Dead: `Map.jsx` no longer declares a `setDatasetsSelected` prop, yet `MapContainer.jsx:14`
      still reads it from context and `:146` still forwards it — a prop handed to a component that
      does not accept it. Layer id `'points-hovered'` is in `POINT_LAYERS` but never added anywhere
      in the repo (`Map.jsx:1224` is its sole occurrence); a `getLayer` guard makes it silently
      inert. Both are safe to delete today, independently of everything else in this section.
      **[re-verified]**
- [ ] `Map.jsx` reads the URL directly twice (`useSearchParams` at 375, and
      `new URL(window.location.href)` at 3087 inside the `load` handler), bypassing both context and
      its props. There are **eight** independent modules reading `window.location` across eleven
      sites (`index.jsx:36`, `config.js:13`, `state/usePersistentState.js:46`,
      `FilterProvider.jsx:249`, `SelectionProvider.jsx:89`,
      `MapStateProvider.jsx:107,177,218,249,269`). **[re-verified — count unchanged;
      `SelectionProvider` moved 75 → 89]**

**Suggested order**, cheapest proof first. Steps 1–3 are unblocked; 4–5 are not.

1. ~~`griddapOutranksHexesIn` and `buildTileSuffix`~~ — **DONE 2026-09-10.** `buildTileSuffix` moved
   to `Map/tileQuery.js` (body byte-identical, verified mechanically); `griddapOutranksHexesIn` moved
   to `Map/hitTest.js` as `(hits, zoom)`, taking the camera scalar as an argument instead of reading
   `map.current` — the first function through the seam. `griddapPriorityZoom` went with it as the
   exported `GRIDDAP_PRIORITY_ZOOM`, so `griddapCoveredIn` (still in `Map.jsx`, it is part of the
   step-4 group) now imports the threshold its other half tests. 22 tests in
   `tileQuery.test.js` + `hitTest.test.js`; suite 117 passed, `eslint .` clean, `vite build` passes.
   `HEX_METRIC` and `PROFILE_TYPE_KEYS` left `Map.jsx`'s import list with the function.
2. The twin maths — give `pointRadiusFor` the range as a parameter instead of reading the ref, move
   both into a module, and test that they agree across a swept range at `padding = 0`.
3. `buildFeatureQuery(e, hits)` → `(lngLat, hits)`. Zero-behaviour diff, removes the last event
   coupling, done before the risky move rather than inside it.
4. The hit-test group above — the largest prize, and much narrower than "largest risk" implies, but
   there is no e2e gate under hover/click ranking (see the preamble). So: settle the
   `queryRenderedFeatures` question, then move in a commit that is *provably* a pure move — bodies
   byte-identical, no tidying — and add characterisation tests against the new module immediately.
   Extract-and-tidy in one commit is still an unverified refactor.
5. The 1749-line mount effect and the guards — leave alone until there is a Playwright gate that
   actually drives the canvas. Nothing in 1–4 requires moving them.

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

## P3 — Performance — **measured against production** (2026-09-10)

The section was written from a static read and headed "not yet measured". It has now
been measured with `EXPLAIN (ANALYZE, BUFFERS)` on the SQL the routes actually emit,
first against a local dev volume and then — because the dev volume turned out to
mislead on two counts — against **production** (`cioos-co-prod-coolify`, read-only).

Production, 2026-09-10:

| table | rows | size |
|---|---|---|
| `trajectory_hexes` | 794 545 | 332 MB |
| `trajectory_points` | 499 054 | 275 MB |
| `profiles` | 375 951 | **805 MB** (~2.2 kB/row) |
| `points` | 256 581 | 122 MB |
| `harvest_attempts` | 5 819 | 4.8 MB |
| `datasets` | 2 164 | 3.5 MB |
| `obis_cells` | **0** | — |

Two things the dev volume got wrong, both of which changed conclusions:

1. **Scale.** `/legend` is **2 341 ms** in production, not the 294 ms measured locally.
   Anything sized as a percentage of the local number was undersized ~8x.
2. **Distribution — and it is inverted.** Local data was recent-heavy; production
   `profiles.time_max` has a median of **2003** (p25 1991, p75 2015). So "recent data
   only" filters are *more* selective in production and "historical only" filters are
   *less* selective than the local measurements suggested. Measured from production
   statistics: `time_max >= 2020` → 12.5% of rows, `depth_max >= 1000` → 7.4%,
   `time_min <= 2005` → 52%, `depth_min <= 10` → 97%.

Also worth knowing before planning anything OBIS-shaped: **production has no OBIS rows
at all**, so every occurrence-cell and scientific-name path is currently unexercised
there.

Measuring changed the answer on six of the twelve items. Each item below carries the
numbers that decided it, so none of this has to be re-derived — and a number quoted
below is a *production* number unless it says otherwise.

### Open — the section's real headline

- [ ] **`/legend` takes 2 341 ms in production and gates first map paint.** (1 033 ms
      with a time filter active.) This was previously written up as a missing spatial
      prefilter, which is a misdiagnosis — the ramp domain is over the whole selection by
      design, so there is nothing to prune it to. The actual shape, from
      `EXPLAIN (ANALYZE, BUFFERS)` on production:

        ~730 ms   build the shared hex_records CTE
                    (seq scan profiles 415 ms + trajectory_hexes 312 ms)
        1 422 ms  sub1 / zoom0 aggregate, over 1.17 M spilled CTE rows
          625 ms  sub3 / zoom2 aggregate, including a SECOND independent
                    seq scan of profiles
          433 ms  sub2 / zoom1 aggregate

      830 MB of buffer reads and 75 MB spilled to temp. Two rewrites were measured and
      neither is the answer on its own:
      1. *Derive the point tier from the hex CTE* rather than re-scanning `profiles`:
         **2 337 ms vs 2 341 ms** — a wash on production, and the same wash locally. The
         saved table scan is paid back by the point aggregate reading spilled CTE rows
         instead of table rows.
      2. *Compute only the tier the caller's zoom needs.* Capped by a real coupling:
         `Map.jsx:1283` reads the **zoom2** tier for the point-radius ramp at every zoom,
         so zoom2 can never be dropped and only `sub2` can be skipped — ~433 ms of
         2 341 ms (18%), in exchange for partial-response merging and a second fetch
         trigger in `MapStateProvider.jsx`. Worth doing at this scale, but it is a
         frontend-state change and wants its own pass.

      Anyone picking this up should know two things. `Map.jsx:1265,1274` prefer
      `viewportHexRange` — a ramp measured from the rendered tiles — over the `/legend`
      response as soon as hexes are on screen, so this 2.3 s buys the bootstrap and
      empty-view value, not the steady-state one. And the cost is the **aggregation over
      1.1 M CTE rows**, not the scans: that is what any real fix has to attack
      (materialised per-hex aggregates, avoiding the temp spill, or not deriving the
      domain from a live full-catalogue aggregate at all).

- [ ] **MVT tiles are stored in redis as a JSON array of byte values.**
      `apicache/src/apicache.js:138` does `JSON.stringify(value)` before our adapter sees
      it, so a `Buffer` becomes `{"type":"Buffer","data":[…]}`. Measured on a 200 KB tile:
      **3.6x storage** (731 KB), **9.9 ms of blocking JS per cache write** and **2.4 ms
      per cache hit** — ~48 ms of event-loop time per warm viewport of 20 tiles, on a
      single-threaded server. Base64 in the same envelope would be 1.3x / 0.25 ms /
      0.09 ms. The fix is **not** available in `utils/cache.js`: apicache stringifies
      before calling the adapter and exposes no serializer hook. It needs a small
      binary-aware redis middleware for the three tile routes, bypassing apicache — which
      means re-implementing its key derivation, TTL and redis-down fallback, so it is its
      own item.

### Done

- [x] **Time and depth bounds indexed on the three cell tables — three of the four
      predicates.** The original item was right that no index existed and wrong about
      why: the filter does not fire per slider drag (`FilterProvider.jsx:119-126`
      debounces 500 ms, so a settled drag is one request set). Which columns are worth
      indexing turned out to be a property of production's *distribution*, not of the
      column names, and the local volume pointed the wrong way on one of them — so this
      was settled against a restored copy of production `profiles` and
      `trajectory_hexes`:

        predicate                          rows    scan     indexed
        time_max >= 2020  (start date)      12%    55 ms      16 ms
        time_max >= 2024                     4%    27 ms       5 ms
        time_min <= 1990  (end date)        24%    72 ms      31 ms
        depth_max >= 1000 (deep only)        7%    42 ms      19 ms
        time_min <= 2005                    52%       —   seq scan, ignored
        depth_min <= 10                     97%       —   seq scan, ignored

      `time_min` is indexed **because production's catalogue is historical** — profiles'
      median `time_max` is 2003 and the data reaches back to 1917, so "before 1990"
      really is a quarter of it. The local volume was recent-heavy, where the same index
      goes unused; that reading would have left it out. `depth_min` is not indexed and
      cannot usefully be: the predicate asks "does this feature start above the selected
      floor", true of 97% of rows.

      **The honest whole-query number is smaller than the branch numbers.** On the full
      `/legend` query against production data, the indexes are worth **~19%**
      (380 ms → 309 ms locally) — because `/legend` is dominated by the aggregation over
      1.1 M CTE rows, not by the scan they speed up. They are used only when a filter is
      genuinely narrow; the default range correctly plans a seq scan, so they cost
      nothing when they cannot help, apart from harvest write time on the three largest
      tables. Whether that trade is worth ~19% of the filtered legend is a judgement
      call, recorded here so it can be revisited rather than re-derived.

- [x] **`scientificNames` expansion memoized** (`dbFilter.js`). It ran once per
      `createDBFilter`, i.e. once per uncached tile — ~20 identical expansions per
      viewport, serially ahead of each tile's own query, plus twice for `/download`
      (`getShapeQuery` runs it, then the route runs it again). The **promise** is
      memoized, not the value, so the tiles of one viewport share a single query instead
      of all missing together; a rejection is evicted so a blip is not pinned for the
      TTL. Keyed on the sorted name set, 5-minute TTL to match the route cache.
      **Not measurable in production: there are no OBIS rows there**, so this path is
      currently unexercised and the ~30 ms per expansion is the code's own figure from
      when the data existed.

- [x] **`/harvest` slug resolution indexed.** The `DISTINCT` over the whole append-only
      attempts table is gone; the transform is now a plain predicate backed by
      `harvest_attempts_slug_idx`. This one got *worse* with scale, not better: measured
      on a slug that matches nothing, **0.5 ms locally (293 rows) but 19.9 ms in
      production (5 819 rows)** — superlinear, because the `DISTINCT` and the double
      `regexp_replace` run over every row, on three routes, per request. Verified the
      rewrite returns the same URL as the old query. `listServers`'s correlated scalar
      subquery is now `DISTINCT ON (erddap_url, source)` — the shape `recentRuns` already
      uses — and was diffed against the old version on real data: identical.

- [x] **`datasetHistory` bounded** at 200 rows with the truncation reported, because
      `HarvestDataset.jsx` renders every row it is handed into an unpaginated table.
      Scale note: production currently holds **one attempt per dataset** (10 runs,
      5 819 attempts, 2 164 datasets), so this cap does not bite today — it is a guard on
      an append-only table that gains a row per dataset per run, not a fix for a live
      problem.

- [x] **Knex pool max raised to 32** (`db.js`), with the reasoning in the comment:
      `/legend` holds 2 connections and `/download` 3+, so 16 saturated at ~8 concurrent
      legend requests — and `/legend` is a 2.3 s query that gates first map paint, so
      those connections are held for a long time.

- [x] **`4_create_hexes.sql` centroid computed once per cell.** Was four PostGIS calls
      per output row in both UNION arms; now a `used_cells` → `hex_pos` CTE resolves each
      distinct cell once (two calls) and the two arms collapse into one INSERT. Verified
      by rebuilding a dataset's rows in a transaction and diffing against the stored
      rows: 43 rows, 0 differing. Load-path only.

- [x] **`obis_scientific_name_popularity` off the load path.** It has no runtime reader —
      only `populate_vernaculars.py`'s `--top N` ordering — so it is refreshed there
      (once per run, CONCURRENTLY, failure tolerated) instead of after every harvest.
      `obis_scientific_names`, which the web-api reads live, still refreshes on load.

### Closed by measurement — do not re-raise without new numbers

- [x] **`cde.datasets` indexes: still not worth it, but it is closer than it looks.**
      2 164 rows / 3.5 MB. Every tile and legend query already reaches it by
      `Index Only Scan using datasets_pkey`, because it is the small build side of a hash
      join. The one query where the missing `pk_url` index shows is
      `/trajectories/track`: the `datasets` seq scan is **98% of its estimated cost**
      (408 of 416 units) and **1.35 ms of its 3.2 ms** actual runtime. Real, but 1.35 ms.
      GIN on `organization_pks`/`eovs`/`obis_nodes` would sit unused on a 2 164-row table
      and slow every harvest write. Revisit if the catalogue reaches five figures, or if
      `pk_url` lookups move onto a hot path.
- [x] **`/preview` has a cache** — added since the audit (`preview.js:173-174`, 5 minutes
      with `cache.onlyOk`). The `COALESCE(profile_id, timeseries_id)` filter is still
      unindexable but the branch is reached through `profiles(dataset_pk)`, so it is
      already bounded to one dataset.
- [x] **"Eleven unbounded routes" was mostly a false positive.** `/datasets`,
      `/organizations`, `/platforms`, `/oceanVariables`, `/obisNodes` and
      `/erddapServers` return one row per catalogue entry and the frontend needs all of
      them — a LIMIT would silently truncate the filter menus. `/trajectories/track` is
      bounded by the harvester's retained-fix cap (`trajectories.js:77`) and
      `/pointQuery` by the drawn selection. Only `datasetHistory` grew without bound;
      that one is capped above.

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
- [ ] `cde.skipped_datasets` — written by the harvester and SQL, never read by web-api. **Do not
      delete it**: `prune_stale_datasets` reads `temp_skipped_datasets` as the "this dataset errored,
      don't prune it" signal, which is the P0 item added 2026-09-09. Unread by web-api is not unused.
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

### Clarity, not speed

- [ ] `griddapCoverage.js:54` selects `d.*` from a CTE to use eight fields. Moved down from P3:
      the CTE is referenced once, so Postgres inlines it and prunes the projection — the two jsonb
      blobs and the stored geometry are never materialised, and there is no time to win. An explicit
      column list would still be worth writing, because it would document which `cde.datasets`
      columns dbFilter's unqualified predicates depend on (`selection.js` explains why they have to
      be in scope at all).

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
      Two of the P1 items added 2026-09-09 (the unset `over_limit`, the OBIS path that skips the
      budget) are consequences of this function owning the byte accounting and the OBIS branch
      leaving before it — worth reading together with them before splitting it.
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
      `update_download_jobs` (the string-built SQL) and `send_email`. **Stale as written
      [2026-09-09]:** `download_scheduler/tests/` now holds `conftest.py`, `test_worker_loop.py`,
      `test_download_email.py` and `test_queue_liveness.py`, and `pyproject.toml:24-25` has pytest +
      pytest-mock. `run_download`'s success/failure paths and `email_user`'s templating are still the
      uncovered part; the lease and email-isolation items in P1 (2026-09-09) both land here and are
      the natural next tests.
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
