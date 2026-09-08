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

## P0 — Broken now — **COMPLETE** (2026-09-08)

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

## P1 — Cheap, independent, safe — **DONE except two deferred items** (2026-09-08)

Everything below is closed unless marked **[deferred]**. The two that remain — `LICENSE`
and the Python packaging consolidation — were scoped out deliberately: they are not cheap,
and each needs its own pass. The JS-style, ESLint-flat-config and Sentry items were closed
by the styling-unification pass; see that section and the verification at the end.

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
- [ ] **React hooks findings, now 45 under the v7 plugin.** `eslint-plugin-react-hooks@7`
      ships 16 rules; **11 pass and are enabled**. Five are off because they have
      pre-existing findings whose fixes change render behaviour: `rules-of-hooks`,
      `exhaustive-deps`, and the new React Compiler rules `set-state-in-effect` (43),
      `refs` (1) and `immutability` (1).
      Original note (eslint 8 / plugin v4): enabling `plugin:react-hooks/recommended` reports 54
      `exhaustive-deps` and 3 `rules-of-hooks`. The three look like genuine bugs:
      `DatasetPreviewTable.jsx:12-13` calls `useTranslation`/`useState` conditionally, and
      `utilities.jsx:23` calls `useTranslation` inside a plain function. The plugin is now
      registered in `frontend/.eslintrc.js` (so the existing disable comment resolves) with
      both rules **off** and this pointer in a comment. Fixing them changes render behaviour.
- [ ] `harvester/tests/unit/test_schema_rebuild.py::test_database_url_still_builds_when_complete`
      fails in a full-suite run but passes alone: the repo `.env`'s `DB_PORT=5433` leaks in
      via a `load_dotenv()` at import time. Pre-existing (confirmed identical on a stashed
      tree) and environment-dependent, so CI does not see it. Worth an isolated fixture.

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
- [ ] The frontend has no `reactRouterV6BrowserTracingIntegration`, so Sentry transactions
      carry raw URLs rather than parameterised route names despite react-router-dom 6.30.4.

### Verification for this sweep

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
