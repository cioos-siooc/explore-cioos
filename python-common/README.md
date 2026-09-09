# cde-python-common

The neutral layer under the **Python** side of CIOOS Explorer — named for the
language on purpose, because `web-api/` and `frontend/` are JavaScript and share
nothing with this. Three services sit on top of it — `harvester/`, `downloader/`
and `download_scheduler/` — and each one needs the same handful of things before
it can do anything useful.

The import path stays `cde_common` (a Python import is self-evidently Python);
only the directory and the distribution name carry `python`, the same way the
project names and package names already differ elsewhere in the tree
(`harvester` / `cde_harvester`, `downloader` / `erddap_downloader`).

| Module | Owns |
| --- | --- |
| `cde_common.env` | Loading `.env` into the process environment, once per working directory |
| `cde_common.db` | The CDE connection string, its required settings, and SQLAlchemy engines |
| `cde_common.http` | The `requests` retry session and the HTTP timeout policy |
| `cde_common.observability` | `sentry_sdk.init()` — one policy for every service |
| `cde_common.errors` | The `reason_code` vocabulary written to the database |
| `cde_common.issues` | Grouping pipeline failures into one Sentry issue per (component, server, error) |

## Why it exists

All six used to live under `harvester/cde_harvester/core/`, so the downloader and
the download scheduler imported `cde_harvester` — and with it Prefect, duckdb,
redis, pandera and erddapy — to reach an error-code constant and a connection
string. Worse, the pieces they did *not* import they reimplemented: the retry
session existed in four variants, `.env` loading in three (each behind a
different single-variable sentinel), and `sentry_sdk.init()` twice with
different integrations and sample rates. Two of those copies had already drifted
into a real bug — the scheduler built its connection from `DB_HOST` while the
code it imported read `DB_HOST_EXTERNAL`.

Nothing here may import from `cde_harvester`, `erddap_downloader` or
`download_scheduler`; the dependency arrow only ever points down.

## Environment variables

Read by `cde_common.db` (see `.env.sample` at the repository root):

- `DB_NAME`, `DB_USER`, `DB_PASSWORD` — required; there is no sensible default,
  and `missing_db_settings()` exists so a service can say so up front.
- `DB_HOST_EXTERNAL`, then `DB_HOST`, then `localhost` — first non-empty wins.
  Both names are accepted because the compose files use them for different
  audiences (`DB_HOST=db` for services on the container network,
  `DB_HOST_EXTERNAL` for a harvester reaching Postgres over the VPN) and every
  `.env.sample` ships only `DB_HOST`.
- `DB_PORT` — defaults to 5432.

Read by `cde_common.observability`:

- `SENTRY_DSN` — empty or unset disables reporting.
- `ENVIRONMENT` — defaults to `development`.
- `SENTRY_TRACES_SAMPLE_RATE` — defaults to 1.0, same variable web-api reads.
