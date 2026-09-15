import { vi } from "vitest";

import { server } from "../config.js";

// Stub fetch for the Harvest dashboard's own endpoints (${server}/harvest/...),
// which read from cde.harvest_attempts / cde.harvest_runs / cde.download_jobs.
// The e2e fixture set (installMockFetch, e2e/fixtures/) is recorded from the
// main app and carries none of these — a second corpus recorded against the
// harvest routes is out of scope here, so this stubs exactly what each test
// asks for instead, keyed by the path useHarvestFetch requests
// (everything after "/harvest", query string included, e.g. "/servers" or
// "/servers/erddap-example-com?status=error").
//
// `routes` maps that path to the JSON body to answer with (or `null` for a
// fetch that should 404, exercising the hook's error path).
export function installMockHarvestFetch(routes) {
  const marker = `${server}/harvest`;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      const url = typeof input === "string" ? input : input.url;
      if (!url.startsWith(marker)) {
        throw new Error(`installMockHarvestFetch: unexpected fetch ${url}`);
      }
      const path = url.slice(marker.length) || "/";
      if (!(path in routes) || routes[path] === null) {
        return new Response(null, { status: 404 });
      }
      return new Response(JSON.stringify(routes[path]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}
