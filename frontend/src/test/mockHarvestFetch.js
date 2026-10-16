import { vi } from "vitest";

import { server } from "../config.js";

// The e2e fixtures carry no /harvest routes. `routes` maps the path after
// "/harvest" (query included) to a JSON body, or `null` for a 404.
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
