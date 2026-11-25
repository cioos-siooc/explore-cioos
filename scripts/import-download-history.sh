#!/usr/bin/env bash
# Copy the old build's download history into this stack's database, for usage
# reporting. Run on the production host after the proxy points at the new stack:
#
#   scripts/import-download-history.sh [old-project] [new-project]
#
# Re-runnable: jobs already imported (same job_id) are skipped. Jobs the old
# stack never finished are imported as failed, so the new scheduler doesn't
# pick them up. Emails past retention are cleared by the scheduler's next poll.
set -euo pipefail

OLD_PROJECT=${1:-explore-cioos-production}
NEW_PROJECT=${2:-explore-cioos-v2}
COLUMNS="time, job_id, email, status, download_size, estimate_size, estimate_details,
  erddap_report, time_start, time_complete, downloader_input, downloader_output"

db_container() {
  local id
  id=$(docker ps -q -f "label=com.docker.compose.project=$1" -f label=com.docker.compose.service=db)
  [ -n "$id" ] || { echo "No running db container in compose project $1" >&2; exit 1; }
  echo "$id"
}

db_psql() {
  local container=$1
  shift
  docker exec -i "$container" sh -c 'psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' psql "$@"
}

old=$(db_container "$OLD_PROJECT")
new=$(db_container "$NEW_PROJECT")

db_psql "$old" -c "COPY (SELECT $COLUMNS FROM cde.download_jobs ORDER BY time, pk) TO STDOUT" |
  db_psql "$new" -1 \
    -c "CREATE TEMP TABLE old_jobs AS SELECT $COLUMNS FROM cde.download_jobs WITH NO DATA" \
    -c "COPY old_jobs FROM STDIN" \
    -c "INSERT INTO cde.download_jobs ($COLUMNS, email_domain)
        SELECT time, job_id, email,
               CASE WHEN status IN ('open', 'downloading') THEN 'failed' ELSE status END,
               download_size, estimate_size, estimate_details, erddap_report, time_start,
               CASE WHEN status IN ('open', 'downloading') THEN coalesce(time_complete, time_start, time)
                    ELSE time_complete END,
               -- The cast rejects input the scheduler's email cleanup couldn't parse.
               downloader_input::jsonb::text, downloader_output,
               lower(split_part(email, '@', 2))
        FROM old_jobs ORDER BY time
        ON CONFLICT (job_id) DO NOTHING" \
    -c "SELECT count(*) AS old_jobs, (SELECT count(*) FROM cde.download_jobs) AS jobs_now FROM old_jobs"
