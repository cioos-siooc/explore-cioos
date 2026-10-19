import { vi } from "vitest";

import { resolveFixture } from "../../e2e/support/fixtureStore.js";

// Serves the same e2e/fixtures/ as the Playwright router, so the two suites
// can't disagree about the API. Per test, not global: an unexpected fetch is
// worth finding out about.

// Returns urls with no fixture; the rejection alone already fails the render.
export function installMockFetch() {
  const missing = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      const url = typeof input === "string" ? input : input.url;
      const fixture = resolveFixture(url);

      if (fixture.empty) return new Response(null, { status: 204 });
      if (fixture.missingPath) {
        missing.push(`${url}  (no fixture at ${fixture.missingPath})`);
        // 404, not a throw, so the component takes its real error path.
        return new Response("missing fixture", { status: 404 });
      }
      return new Response(fixture.body, {
        status: 200,
        headers: { "content-type": fixture.contentType },
      });
    }),
  );

  return missing;
}
