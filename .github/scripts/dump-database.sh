#!/usr/bin/env bash
# Stream a custom-format dump of one database of the stack to stdout:
#   dump-database.sh [db]    (default: the stack's own database)
set -euo pipefail

docker compose exec -T db sh -c \
  'exec pg_dump -U "$POSTGRES_USER" -Fc -d "${1:-$POSTGRES_DB}"' sh "${1:-}"
