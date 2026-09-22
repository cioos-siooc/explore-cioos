# CLAUDE.md

CDE (CIOOS Data Explorer): harvests oceanographic dataset metadata from ERDDAP,
OBIS and CKAN into PostgreSQL/PostGIS and serves a map-first search/download UI
over it. Six services; each has its own `CLAUDE.md` (loaded only when working
there): `harvester/`, `database/`, `web-api/`, `frontend/`, `downloader/`,
`download_scheduler/`.

Human docs live in `README.md`; read the relevant section when you need it:

- **Architecture** — service diagram.
- **Starting using docker** — local stack setup (`./scripts/init-dev-env.sh`
  creates the gitignored configs).
- **Linting and tests** — every lint/test command, single-test invocations, the
  uv/lockfile rules.
- **Front End Development** — local frontend against a local or remote API.
- **CI/CD**, **Deploying with Coolify**, **Production deployment** — deploys, and
  the `Rebuild Database` deployment needed after a schema change.

Gotchas worth knowing without opening the README:

- Images bake source (no bind mount): rebuild, don't restart.
- `uv lock --check` must pass in `.`, `harvester`, `downloader`,
  `download_scheduler` — images build with `uv sync --locked`.

## Workflow requirements

- **Think before coding**: Don't assume. Don't hide confusion. Surface tradeoffs.
- **Simplicity first**: Minimum code that solves the problem. Nothing speculative.
- **Surgical Changes**: Touch only what you must. Clean up only your own mess.
- **Lint before calling any change done**: a `PostToolUse` hook (`.claude/hooks/lint-on-edit.sh`) already enforces this automatically.
- **New features need tests**: add unit tests (and e2e/integration where warranted) using each sub-project's existing patterns.
- **Flag tests that changes break**: if an edit changes behavior an existing test asserts on, tell the user which test(s) need rewriting instead of silently weakening the assertion.
- **Code is the documentation**: keep comments to the strict minimum (only non-obvious _why_, never _what_); don't add docs/docstrings/READMEs unless requested.
