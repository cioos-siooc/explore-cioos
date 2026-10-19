import { readFileSync } from "node:fs";
import { join } from "node:path";

import { fixtureKey } from "./fixtureKey.js";
import { FIXTURES_DIR } from "./fixturesDir.js";

// Used by both the Playwright router and the jsdom fetch stub.

function read(relativePath) {
  try {
    return readFileSync(join(FIXTURES_DIR, relativePath));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

// Query-specific first, then the bare endpoint: most endpoints answer the same
// whatever the query, so only /pointQuery and /legend need keyed variants.
// `missingPath` must be treated as a loud failure, not an empty response.
export function resolveFixture(url) {
  const key = fixtureKey(url);

  if (key.isTile) {
    const body = read(key.path);
    return body
      ? {
          body,
          contentType: key.path.endsWith(".png")
            ? "image/png"
            : "application/x-protobuf",
        }
      : // An unrecorded tile is "nothing here" (204), not an error.
        { empty: true };
  }

  const body = read(key.path) ?? read(`api/${key.name}.json`);
  if (!body) return { missingPath: key.path };
  return { body, contentType: "application/json" };
}

export { fixtureKey };
