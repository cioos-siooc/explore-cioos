#!/usr/bin/env sh
# Run a Playwright command inside the image CI uses, from the frontend directory.
#
# The screenshot baselines and the a11y node counts are both readings of a
# rendered page, and both move with the fallback font stack: the mock network
# serves the webfonts empty on purpose, so every family falls through to
# `system-ui`/`sans-serif`, which resolves to a different physical face on every
# machine. A phone-width list therefore holds a different number of cards on a
# developer's host than in CI, and axe — which can only judge contrast against
# what it can composite, i.e. what is inside the viewport — counts a different
# number of nodes. Recording on a host and enforcing in the container is what
# made the a11y baseline unreproducible; this keeps the writer and the reader in
# the same place.
#
# The image tag is derived from the installed @playwright/test rather than
# written down, because a mismatch fails obscurely with "Executable doesn't
# exist at /ms-playwright/…".
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
