#!/usr/bin/env bash
# Replace a scratch database of the stack with the dump read on stdin:
#   dump-database.sh | restore-database.sh <db>
# Only *_staging / *_next names are accepted, so a live database can never be
# the target, whatever DB_NAME the stack uses.
set -euo pipefail

db=$1
case "$db" in
  *_staging | *_next) ;;
  *) echo "Refusing to overwrite '$db': only *_staging or *_next databases" >&2; exit 1 ;;
esac

# --no-owner/--no-acl: staging and production use different DB users.
docker compose exec -T db sh -c '
  set -e
  dropdb -U "$POSTGRES_USER" --if-exists --force "$1"
  createdb -U "$POSTGRES_USER" "$1"
  exec pg_restore -U "$POSTGRES_USER" -d "$1" --no-owner --no-acl --exit-on-error
' sh "$db"
