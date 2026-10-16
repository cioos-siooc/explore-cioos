import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// No import.meta.url: Playwright transpiles these modules to CJS, where it is a
// syntax error.
function findFixtures() {
  let directory = resolve(process.cwd());
  for (let depth = 0; depth < 5; depth++) {
    const candidate = join(directory, "e2e", "fixtures");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(
    `could not find e2e/fixtures from ${process.cwd()} — run the tests from the frontend directory`,
  );
}

export const FIXTURES_DIR = findFixtures();
