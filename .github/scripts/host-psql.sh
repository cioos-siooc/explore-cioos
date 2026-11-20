#!/usr/bin/env bash
# psql in the stack's db container, as its superuser, on the stack's own
# database unless a -d argument says otherwise. Unaligned, tuples-only output.
set -euo pipefail

docker compose exec -T db sh -c \
  'PGDATABASE=$POSTGRES_DB exec psql -U "$POSTGRES_USER" -v ON_ERROR_STOP=1 -q -At "$@"' sh "$@"
