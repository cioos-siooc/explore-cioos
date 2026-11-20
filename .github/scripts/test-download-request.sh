#!/usr/bin/env bash
# Submit a bounded download request against a running stack, wait for the
# scheduler, then verify that nginx serves a valid archive.
#   SITE_URL  the stack's public root (default: the local Compose stack)
#   PSQL      command reaching its database (default: psql in the local db
#             container, which needs COMPOSE_FILES)
set -euo pipefail

SITE_URL=${SITE_URL:-http://localhost:8098}
: "${PSQL:=docker compose ${COMPOSE_FILES:?COMPOSE_FILES must name the Compose files} exec -T db psql -U postgres -d cde}"

sql() { $PSQL -At -F ' ' -c "$1"; }

read -r latitude longitude time_min time_max < <(
  sql "SELECT latitude, longitude, to_char(time_min AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), to_char(time_max AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') FROM cde.profiles WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND time_min IS NOT NULL AND time_max IS NOT NULL LIMIT 1"
)
test -n "${latitude:-}" && test -n "${longitude:-}"
test -n "${time_min:-}" && test -n "${time_max:-}"

API_URL="$SITE_URL/api" CI_LATITUDE="$latitude" CI_LONGITUDE="$longitude" \
  CI_TIME_MIN="$time_min" CI_TIME_MAX="$time_max" \
  npm --prefix test run test:download

job_id="$(sql "SELECT job_id FROM cde.download_jobs ORDER BY pk DESC LIMIT 1")"
test -n "$job_id"

for _ in $(seq 1 60); do
  status="$(sql "SELECT status FROM cde.download_jobs WHERE job_id = '$job_id'")"
  case "$status" in
    completed)
      curl --fail --retry 5 --retry-all-errors \
        "$SITE_URL/downloads/cde_download_${job_id}.zip" \
        --output download.zip
      unzip -t download.zip
      exit 0
      ;;
    failed|no-data|over-limit)
      echo "Download job $job_id finished with status: $status" >&2
      exit 1
      ;;
  esac
  sleep 5
done

echo "Timed out waiting for download job $job_id (last status: $status)" >&2
exit 1
