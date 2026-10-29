#!/bin/sh
# ENTRYPOINT of the Python images: run the command as `app`, not root.
#
# Starts as root only to take over $WRITABLE_DIRS: volumes from when these
# images ran as root, and anything a `docker compose exec` (which skips this
# entrypoint, so runs as root) left there, hold files `app` could not write.
set -e

if [ "$(id -u)" = 0 ]; then
  for dir in $WRITABLE_DIRS; do
    find "$dir" ! -user app -exec chown app:app {} +
  done
  # setpriv keeps the environment, so HOME would still be /root.
  HOME=/home/app exec setpriv --reuid=app --regid=app --init-groups "$@"
fi
exec "$@"
