import { readFileSync } from "node:fs";
import { join } from "node:path";

import { EXTERNAL_HOSTS, externalKey } from "./fixtureKey.js";
import { resolveFixture } from "./fixtureStore.js";
import { FIXTURES_DIR } from "./fixturesDir.js";

// Every basemap raster tile: third-party cartography changes without notice,
// the flakiest thing a visual baseline could contain.
const BLANK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

// First paint waits on every basemap source loading, so a stuck source times
// out every spec. Its .pbf tiles come back 204 from this router.
const EMPTY_TILEJSON = JSON.stringify({
  tilejson: "2.2.0",
  tiles: ["https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf"],
  // basemapStyle.js's ofm layers; MapLibre logs an error for each undeclared one.
  vector_layers: ["boundary", "place", "water", "water_name", "waterway"].map(
    (id) => ({ id, fields: {} }),
  ),
  minzoom: 0,
  maxzoom: 14,
  bounds: [-180, -85.051129, 180, 85.051129],
});

const TELEMETRY_HOSTS = ["ingest.sentry.io", "plausible.cioos.ca"];
const GEONAMES_HOST = "geogratis.gc.ca";

// Playwright runs route handlers in REVERSE registration order. Returns the
// un-mocked request urls, asserted empty on teardown.
export async function installMockApi(context, { appOrigin, apiOrigin }) {
  const unexpected = [];

  // Registered first => runs last => the backstop.
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    // Webfonts served empty: late-arriving fonts reflow screenshots mid-capture.
    if (url.origin === appOrigin && /\.woff2?$/.test(url.pathname)) {
      return route.fulfill({
        status: 200,
        contentType: "font/woff2",
        body: "",
      });
    }
    if (url.origin === appOrigin) return route.continue();
    if (TELEMETRY_HOSTS.some((host) => url.host.endsWith(host))) {
      // 204, not abort: an abort logs a console error the guard fails on.
      return route.fulfill({ status: 204, body: "" });
    }
    unexpected.push(route.request().url());
    return route.abort("blockedbyclient");
  });

  // Registered after => run first => they win. GeoNames (the region search)
  // is the one third-party API the app queries, so it answers from the same
  // fixture set.
  await context.route(
    (url) => url.origin === apiOrigin || url.host === GEONAMES_HOST,
    (route) => {
      const fixture = resolveFixture(route.request().url());
      if (fixture.empty) return route.fulfill({ status: 204, body: "" });
      if (fixture.missingPath) {
        unexpected.push(
          `${route.request().url()}  (no fixture at ${fixture.missingPath})`,
        );
        return route.abort("blockedbyclient");
      }
      return route.fulfill({
        status: 200,
        contentType: fixture.contentType,
        body: fixture.body,
      });
    },
  );

  for (const host of EXTERNAL_HOSTS) {
    await context.route(`**://${host}/**`, (route) => {
      const url = new URL(route.request().url());

      if (
        url.pathname.endsWith(".png") ||
        url.pathname.match(/\/\d+\/\d+\/\d+$/)
      ) {
        return route.fulfill({
          status: 200,
          contentType: "image/png",
          body: BLANK_PNG,
        });
      }
      // Glyphs: 204 makes MapLibre drop labels instead of logging an error.
      if (url.pathname.endsWith(".pbf")) {
        return route.fulfill({ status: 204, body: "" });
      }

      const recorded = tryRead(`${externalKey(route.request().url())}.json`);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: recorded ?? EMPTY_TILEJSON,
      });
    });
  }

  return unexpected;
}

function tryRead(relativePath) {
  try {
    return readFileSync(join(FIXTURES_DIR, relativePath));
  } catch {
    return undefined;
  }
}
