#!/usr/bin/env bash
# Initialize a local dev environment by creating the three gitignored config
# files the stack needs from their tracked templates.
#
#   ./scripts/init-dev-env.sh            # create what's missing, skip the rest
#   ./scripts/init-dev-env.sh --force    # overwrite existing files too
#
# Then: docker compose up -d
set -euo pipefail

# target=source, relative to the repo root
FILES=(
  ".env=.env.sample"
  "docker-compose.override.yaml=docker-compose.override.yaml.sample"
  "harvest_config.yaml=harvest_config.production.yaml"
)

force=false
case "${1:-}" in
  -f | --force) force=true ;;
  -h | --help)
    sed -n '2,8p' "$0" | sed 's/^# \?//'
    exit 0
    ;;
  "") ;;
  *)
    echo "unknown option: $1 (try --help)" >&2
    exit 2
    ;;
esac

cd "$(dirname "$0")/.."

created=0 skipped=0
for pair in "${FILES[@]}"; do
  target=${pair%%=*}
  source=${pair#*=}

  if [[ ! -f $source ]]; then
    echo "missing template: $source" >&2
    exit 1
  fi

  if [[ -e $target ]] && ! $force; then
    echo "skip    $target (already exists; --force to overwrite)"
    skipped=$((skipped + 1))
    continue
  fi

  cp "$source" "$target"
  echo "created $target <- $source"
  created=$((created + 1))
done

echo "$created created, $skipped skipped. Next: docker compose up -d"
