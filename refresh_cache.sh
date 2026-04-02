#!/bin/bash
#
# refresh_cache.sh
#
# 1. Parse nginx access logs for the top 500 API queries
# 2. Flush the Redis cache
# 3. Replay those queries to warm the cache
#
# Usage: ./refresh_cache.sh [OPTIONS]
#   -l PATH   nginx access log file  (default: ./nginx/logs/access.log)
#   -r NAME   redis container name   (default: auto-detect *redis*)
#   -h HOST   API base URL           (default: http://localhost:8098/api)
#   -c COUNT  number of top queries  (default: 500)
#   -d        dry-run — show queries without flushing or replaying

set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="$SCRIPT_DIR/nginx/logs/access.log"
REDIS_CONTAINER=""
API_BASE="http://localhost:8098/api"
TOP_N=500
DRY_RUN=false

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while getopts "l:r:h:c:d" opt; do
  case $opt in
    l) LOG_FILE="$OPTARG" ;;
    r) REDIS_CONTAINER="$OPTARG" ;;
    h) API_BASE="$OPTARG" ;;
    c) TOP_N="$OPTARG" ;;
    d) DRY_RUN=true ;;
    *) echo "Usage: $0 [-l log_file] [-r redis_container] [-h api_base] [-c count] [-d]" >&2; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Validate log file and auto-detect redis container
# ---------------------------------------------------------------------------
if [ ! -f "$LOG_FILE" ]; then
  echo "ERROR: Nginx access log not found at: $LOG_FILE" >&2
  echo "Make sure the nginx logs volume is mounted (./nginx/logs:/var/log/nginx)." >&2
  exit 1
fi

if [ -z "$REDIS_CONTAINER" ]; then
  REDIS_CONTAINER=$(docker ps --format '{{.Names}}' | grep -i redis | head -1)
  if [ -z "$REDIS_CONTAINER" ]; then
    echo "ERROR: Could not find a running redis container. Use -r to specify." >&2
    exit 1
  fi
fi

echo "Nginx log file  : $LOG_FILE"
echo "Redis container : $REDIS_CONTAINER"
echo "API base URL    : $API_BASE"
echo "Top queries     : $TOP_N"
echo "Dry run         : $DRY_RUN"
echo "-------------------------------------------"

# ---------------------------------------------------------------------------
# Step 1 — Extract the top N API queries from nginx access logs
# ---------------------------------------------------------------------------
# Default nginx combined log format:
#   <ip> - - [date] "<METHOD> <URI> HTTP/x.x" <status> <size> "<referer>" "<ua>"
#
# We extract the request URI for GET requests to /api/*, strip the /api prefix
# (since we'll prepend API_BASE), deduplicate by counting, and keep the top N.
# ---------------------------------------------------------------------------
echo ""
echo "=== Step 1: Extracting top $TOP_N API queries from nginx logs ==="

TMPFILE=$(mktemp)
trap "rm -f $TMPFILE" EXIT

cat "$LOG_FILE" \
  | awk '
    # Match GET requests to /api/ paths and extract the URI
    match($0, /"GET \/api\/([^ ]*) HTTP/, arr) {
      uri = arr[1]
      # Skip docs/openapi endpoints
      if (uri ~ /^docs/ || uri ~ /^openapi/) next
      # Skip empty root API call
      if (uri == "" || uri == "/") next
      print uri
    }
  ' \
  | sort \
  | uniq -c \
  | sort -rn \
  | head -n "$TOP_N" \
  | awk '{print $2}' \
  > "$TMPFILE"

QUERY_COUNT=$(wc -l < "$TMPFILE")
echo "Found $QUERY_COUNT unique API queries."

if [ "$QUERY_COUNT" -eq 0 ]; then
  echo "WARNING: No API queries found in nginx logs. Nothing to replay."
  echo "Make sure the log file contains API requests: $LOG_FILE"
  exit 0
fi

echo ""
echo "Top 10 queries (preview):"
head -10 "$TMPFILE" | while read -r uri; do
  echo "  $API_BASE/$uri"
done
if [ "$QUERY_COUNT" -gt 10 ]; then
  echo "  ... and $((QUERY_COUNT - 10)) more"
fi

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo "=== Dry run — skipping flush and replay ==="
  echo "Full query list:"
  cat "$TMPFILE" | while read -r uri; do
    echo "  $API_BASE/$uri"
  done
  exit 0
fi

# ---------------------------------------------------------------------------
# Step 2 — Flush Redis cache
# ---------------------------------------------------------------------------
echo ""
echo "=== Step 2: Flushing Redis cache ==="

echo "Redis DBSIZE before flush:"
docker exec "$REDIS_CONTAINER" redis-cli DBSIZE

docker exec "$REDIS_CONTAINER" redis-cli FLUSHALL
echo "Redis cache flushed."

# ---------------------------------------------------------------------------
# Step 3 — Replay queries to warm the cache
# ---------------------------------------------------------------------------
echo ""
echo "=== Step 3: Replaying $QUERY_COUNT queries to warm cache ==="

SUCCESS=0
FAIL=0
COUNT=0

while IFS= read -r uri; do
  COUNT=$((COUNT + 1))
  URL="$API_BASE/$uri"

  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 60 "$URL")

  if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 400 ]; then
    SUCCESS=$((SUCCESS + 1))
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL ($HTTP_CODE): $URL"
  fi

  # Progress update every 50 queries
  if [ $((COUNT % 50)) -eq 0 ]; then
    echo "  Progress: $COUNT / $QUERY_COUNT (success: $SUCCESS, fail: $FAIL)"
  fi
done < "$TMPFILE"

echo ""
echo "=== Done ==="
echo "Total: $QUERY_COUNT | Success: $SUCCESS | Failed: $FAIL"
echo ""
echo "Redis DBSIZE after warming:"
docker exec "$REDIS_CONTAINER" redis-cli DBSIZE
echo "Redis memory usage:"
docker exec "$REDIS_CONTAINER" redis-cli INFO memory | grep used_memory_human
