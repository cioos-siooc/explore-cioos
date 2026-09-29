#!/bin/sh
# Walks the public paths a visitor depends on, stopping at the first failure so
# `docker inspect` shows which one broke.
for path in /healthz / /api/health/ready /downloads/healthz; do
  if ! out="$(curl -fsS --max-time 4 -o /dev/null "http://127.0.0.1:4000${path}" 2>&1)"; then
    echo "FAIL ${path}: ${out}"
    exit 1
  fi
done
echo "ok"
