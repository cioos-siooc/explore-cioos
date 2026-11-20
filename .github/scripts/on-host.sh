#!/usr/bin/env bash
# Run a local script in a deploy host's stack directory over SSH; stdin and
# stdout pass through, so dumps can be piped host to host:
#   on-host.sh <ssh-target> <dir> <compose-project> <script> [args...]
# The project must be the deploy's stack_name: the directory name isn't.
# The script travels base64-encoded: it need not exist on the host (the repo
# there may be at an older commit) and the remote login shell needn't be bash.
set -euo pipefail

target=$1 dir=$2 project=$3 script=$4
shift 4
ssh -i ~/.ssh/deploy_key -o ServerAliveInterval=60 "$target" \
  "cd $(printf '%q' "$dir") && COMPOSE_PROJECT_NAME=$(printf '%q' "$project") bash -c \"\$(echo $(base64 -w0 "$script") | base64 -d)\" $(printf '%q' "$script") $(printf '%q ' "$@")"
