#!/usr/bin/env bash
# Submit a bounded download request against the Compose stack, wait for the
# scheduler, then verify that nginx serves a valid archive.
set -euo pipefail

: "${COMPOSE_FILES:?COMPOSE_FILES must name the Compose files}"

read -r latitude longitude time_min time_max < <(
  docker compose $COMPOSE_FILES exec -T db \
    psql -U postgres -d cde -At -F ' ' \
    -c "SELECT latitude, longitude, to_char(time_min AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), to_char(time_max AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') FROM cde.profiles WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND time_min IS NOT NULL AND time_max IS NOT NULL LIMIT 1"
)
test -n "${latitude:-}" && test -n "${longitude:-}"
test -n "${time_min:-}" && test -n "${time_max:-}"

CI_LATITUDE="$latitude" CI_LONGITUDE="$longitude" \
  CI_TIME_MIN="$time_min" CI_TIME_MAX="$time_max" \
  npm --prefix test run test:download

job_id="$(docker compose $COMPOSE_FILES exec -T db \
  psql -U postgres -d cde -At \
  -c "SELECT job_id FROM cde.download_jobs ORDER BY pk DESC LIMIT 1")"
test -n "$job_id"

for _ in $(seq 1 60); do
  status="$(docker compose $COMPOSE_FILES exec -T db \
    psql -U postgres -d cde -At \
    -c "SELECT status FROM cde.download_jobs WHERE job_id = '$job_id'")"
  case "$status" in
    completed)
      curl --fail --retry 5 --retry-all-errors \
        "http://localhost:8098/downloads/cde_download_${job_id}.zip" \
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
