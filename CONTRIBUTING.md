# Contributing

The CIOOS Data Explorer is one deployable system built from six services. This
file covers what a change has to satisfy before it merges. For what the system
*is*, start with `README.md`; for the current backlog, `TODO.md` and
`TODO-cde-revisions.md`.

## Layout

| Path                 | What it is                                  | Language        |
| -------------------- | ------------------------------------------- | --------------- |
| `frontend/`          | Vite + React SPA                            | JS (ESM)        |
| `web-api/`           | Express JSON + vector-tile API              | JS (CommonJS)   |
| `harvester/`         | ERDDAP/OBIS/CKAN harvest, Prefect flows     | Python 3.10     |
| `downloader/`        | Builds a user's download from ERDDAP/OBIS   | Python 3.10     |
| `download_scheduler/`| Drains the download queue, emails the user  | Python 3.10     |
| `database/`          | Numbered SQL: schema + functions            | SQL             |
| `nginx/`, `test/`    | Edge proxy; integration smoke tests         | conf, JS        |

## Setup

Python uses [uv](https://docs.astral.sh/uv/); the repo pins 3.10
(`.python-version`) and every project bounds itself to `>=3.10,<3.11`.

```sh
uv sync                      # root workspace (harvester + download_scheduler)
npm --prefix frontend ci
npm --prefix web-api ci
cp .env.sample .env
cp docker-compose.override.yaml.sample docker-compose.override.yaml
cp harvest_config.sample.yaml harvest_config.yaml
docker compose up -d --build
```

## Before you push

Install the hooks once — they cover line endings (`.gitattributes` mandates
LF), stray large files, private keys, ruff, and the four `uv.lock` files:

```sh
uvx pre-commit install
```

Then run what CI runs. **Integration Tests** is the deploy gate, so anything
failing here blocks a release:

```sh
uvx ruff check .                                     # config: [tool.ruff] in ./pyproject.toml
uv run pytest -m "not integration"                   # 535 unit tests
npm --prefix web-api run lint && npm --prefix web-api test
npm --prefix frontend run lint && npm --prefix frontend run build
```

`uv lock --check` must pass in `.`, `harvester`, `downloader` and
`download_scheduler` — both Python Dockerfiles build with `uv sync --locked`,
so a stale lockfile is a broken image, not just a noisy diff.

## Style

There is no formatter. The linters are the contract, and they differ per
project because the code does:

- **Python** — ruff, `line-length = 120`. One config for all three projects;
  ruff finds it by walking up to the root `pyproject.toml`.
- **`web-api/`** — ESLint `airbnb-base`: double quotes, semicolons. The rules
  it relaxes are listed with reasons in `web-api/.eslintrc.js`.
- **`frontend/`** — ESLint `standard` + `plugin:react/recommended`: single
  quotes, **no** semicolons, 2-space indent.

The two JS styles genuinely conflict. Don't copy code between them without
re-running that project's linter.

Comments should say *why*, not *what* — the existing code leans heavily on
this, especially where a fix encodes something non-obvious about ERDDAP,
Postgres or Docker behaviour. Keep that.

## Commits and PRs

- Conventional-commit subjects (`fix(web-api): …`, `ci: …`, `chore(database): …`)
  matching the recent history.
- One concern per PR. The backlog items in `TODO-cde-revisions.md` are written
  to be taken one at a time.
- `CODEOWNERS` requests review automatically.
- Deploys are automatic on `master` (production) and `development`
  (development) once **Integration Tests** passes — see
  `.github/workflows/deploy.yml`.

## Things that will bite you

- **Rebuild, don't restart.** `web-api` and `prefect_worker` bake their source
  into the image; there is no bind mount.
- **Schema changes need a fresh volume.** `database/1_schema.sql` runs only via
  `docker-entrypoint-initdb.d` on an empty volume. The numbered `[3-9]_*.sql`
  files are re-applied on every `up` by the `db_migrate` service, so they must
  stay `CREATE OR REPLACE`-safe.
- **Redis caches API responses.** `FLUSHALL` before measuring anything, and
  never warm a data endpoint before a harvest finishes.
- **The harvest config is never baked into an image.** Supply it at run time
  (`HARVEST_CONFIG_B64`, `HARVEST_CONFIG_FILE`, or a mount).
