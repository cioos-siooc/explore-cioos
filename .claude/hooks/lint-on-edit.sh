#!/usr/bin/env bash
# PostToolUse hook (Edit|Write|MultiEdit): lints the single file that was just
# edited and blocks (exit 2) if the linter reports errors. Missing tooling
# (node_modules not installed) is a warning, not a lint failure, so it does
# not block.
set -uo pipefail

input="$(cat)"
file="$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.path // empty')"

[ -z "$file" ] && exit 0
[ -f "$file" ] || exit 0

run_js_linter() {
  local name="$1" bin_path="$2" file="$3"

  # Only use the project's own pinned binary (node_modules/.bin). Falling
  # back to a stray npx-cached copy can run the wrong major version against
  # this project's config and misreport an environment problem as a lint
  # error, so a missing binary is a skip, not a failure.
  if [ ! -x "$bin_path" ]; then
    echo "$name is not installed (run npm ci) — skipping lint for $file" >&2
    exit 0
  fi

  local output status
  output="$("$bin_path" "$file" 2>&1)"
  status=$?
  if [ $status -eq 0 ]; then
    exit 0
  fi
  echo "$name found lint errors in $file:" >&2
  echo "$output" >&2
  exit 2
}

case "$file" in
  *.py)
    output="$(uvx ruff check "$file" 2>&1)"
    status=$?
    if [ $status -ne 0 ]; then
      echo "ruff found lint errors in $file:" >&2
      echo "$output" >&2
      exit 2
    fi
    ;;
  *.js | *.jsx | *.mjs | *.cjs)
    run_js_linter eslint node_modules/.bin/eslint "$file"
    ;;
  *.css | *.scss)
    run_js_linter stylelint node_modules/.bin/stylelint "$file"
    ;;
  *)
    exit 0
    ;;
esac

exit 0
