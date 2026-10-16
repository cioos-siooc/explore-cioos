#!/usr/bin/env sh
# Run a Playwright command inside the image CI uses, from the frontend directory.
#
# Webfonts are mocked empty, so the system-ui fallback differs per machine and
# moves screenshots and a11y node counts; baselines must be written where CI
# reads them. The image tag tracks @playwright/test, as a mismatch fails with
# "Executable doesn't exist at /ms-playwright/…".
set -eu

version=$(node -p "require('@playwright/test/package.json').version")

exec docker run --rm \
  --ipc=host \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e CI=true \
  -e A11Y_BASELINE="${A11Y_BASELINE:-}" \
  -v "$(pwd):/work" \
  -w /work \
  "mcr.microsoft.com/playwright:v${version}-noble" \
  ./node_modules/.bin/playwright "$@"
