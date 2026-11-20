#!/usr/bin/env bash
# Promote cde_next to the stack's live database, keeping the live
# download_jobs (usage reporting) and the old database as cde_previous.
# Leaves the app services stopped on success (the deploy that follows starts
# them on the new code); restarts them on the untouched database on failure.
# Self-contained: on-host.sh ships only this file to the host.

# $POSTGRES_* expand inside the db container, not here.
# shellcheck disable=SC2016
set -euo pipefail

db() { docker compose exec -T db sh -c "$1" sh "${@:2}"; }
psql() { db 'exec psql -U "$POSTGRES_USER" -v ON_ERROR_STOP=1 -q "$@"' "$@"; }
services=(web-api scheduler prefect_worker)
live=$(db 'echo "$POSTGRES_DB"')

docker compose stop "${services[@]}"
swapped=false
trap '$swapped || docker compose start "${services[@]}"' EXIT

# The live rows may predate the unique job_id (older releases reused IDs).
# The deploy's db_migrate re-runs 3_download_*_migration.sql, which dedupes
# them, restores the constraint as an index and backfills email_domain.
{
  echo 'TRUNCATE cde.download_jobs;'
  echo 'ALTER TABLE cde.download_jobs DROP CONSTRAINT IF EXISTS download_jobs_job_id_key;'
  echo 'DROP INDEX IF EXISTS cde.download_jobs_job_id_key;'
  db 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --data-only -t cde.download_jobs'
  echo "SELECT setval(pg_get_serial_sequence('cde.download_jobs', 'pk'), coalesce(max(pk), 0) + 1, false) FROM cde.download_jobs;"
} | psql -1 -d cde_next >/dev/null

psql -1 -d postgres -v live="$live" >/dev/null <<'SQL'
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  WHERE datname IN (:'live', 'cde_next') AND pid <> pg_backend_pid();
ALTER DATABASE :"live" RENAME TO cde_previous;
ALTER DATABASE cde_next RENAME TO :"live";
SQL
swapped=true
echo "Swapped: cde_next is now $live; the previous database is cde_previous."
