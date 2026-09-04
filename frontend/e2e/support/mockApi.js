import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { EXTERNAL_HOSTS, externalKey } from './fixtureKey.js'
import { resolveFixture } from './fixtureStore.js'
import { FIXTURES_DIR } from './fixturesDir.js'

// A 1x1 transparent PNG, served for every basemap raster tile. The bathymetry
// and imagery layers are third-party cartography that changes without notice —
// the flakiest thing that could go into a visual baseline — and none of the
// behaviour under test depends on what they draw.
const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

// Enough TileJSON for MapLibre to accept the source. This matters more than it
// looks: the first-paint signal waits on every basemap source reporting loaded,
// so a source stuck in flight leaves the splash up forever and times out every
// spec. The tile template points back at the host this router already answers,
// where every .pbf comes back 204 — the source loads, and no label tile is
// fetched.
const EMPTY_TILEJSON = JSON.stringify({
  tilejson: '2.2.0',
  tiles: ['https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf'],
  // The source layers basemapStyle.js draws from ofm. MapLibre validates every
  // style layer against the TileJSON and logs an error for each one whose
  // source-layer is not declared here — which the console guard would fail on,
  // and which would drown any real error in the noise.
  vector_layers: ['boundary', 'place', 'water', 'water_name', 'waterway'].map(
    (id) => ({ id, fields: {} })
  ),
  minzoom: 0,
  maxzoom: 14,
  bounds: [-180, -85.051129, 180, 85.051129]
})

const TELEMETRY_HOSTS = ['ingest.sentry.io', 'plausible.cioos.ca']
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com']

/**
 * Install the offline network for one browser context.
 *
 * Playwright runs matching route handlers in REVERSE registration order, so the
 * catch-all guard is registered first in order to run last. Anything the app
 * starts fetching that nobody mocked lands in the returned array and fails the
 * test by URL, rather than hanging or silently resolving to nothing.
 *
 * @returns the array of un-mocked request urls, asserted empty on teardown
 */
export async function installMockApi (context, { appOrigin, apiOrigin }) {
  const unexpected = []

  // Registered first => runs last => the backstop.
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url())
    // The app's own bundle, styles, fonts and images.
    if (url.origin === appOrigin) return route.continue()
    // Telemetry. Sentry is initialised in every environment (App.jsx) but only
    // enabled in production; plausible is loaded by the page. Neither belongs in
    // the fixture set or on the network, and neither affects what is rendered.
    if (TELEMETRY_HOSTS.some((host) => url.host.endsWith(host))) {
      // 204 rather than abort: an aborted request logs "Failed to load
      // resource" to the console, which the console guard would report as a
      // failure on every single spec.
      return route.fulfill({ status: 204, body: '' })
    }
    // Webfonts. Served empty so the app falls back to the system stack, the
    // same way for every run: fetching real Montserrat/Quicksand/Sora would put
    // a network round trip and a third-party asset inside every screenshot
    // baseline, and a font that arrives late reflows the layout mid-capture.
    if (FONT_HOSTS.some((host) => url.host.endsWith(host))) {
      return route.fulfill({ status: 200, contentType: 'text/css', body: '' })
    }
    unexpected.push(route.request().url())
    return route.abort('blockedbyclient')
  })

  // Registered after => run first => they win.
  await context.route(`${apiOrigin}/**`, (route) => {
    const fixture = resolveFixture(route.request().url())
    if (fixture.empty) return route.fulfill({ status: 204, body: '' })
    if (fixture.missingPath) {
      unexpected.push(`${route.request().url()}  (no fixture at ${fixture.missingPath})`)
      return route.abort('blockedbyclient')
    }
    return route.fulfill({
      status: 200,
      contentType: fixture.contentType,
      body: fixture.body
    })
  })

  for (const host of EXTERNAL_HOSTS) {
    await context.route(`**://${host}/**`, (route) => {
      const url = new URL(route.request().url())

      if (url.pathname.endsWith('.png') || url.pathname.match(/\/\d+\/\d+\/\d+$/)) {
        return route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG })
      }
      // Glyphs: 204 makes MapLibre fall back to no labels rather than log an
      // error, which the console guard would otherwise fail on.
      if (url.pathname.endsWith('.pbf')) {
        return route.fulfill({ status: 204, body: '' })
      }

      const recorded = tryRead(`${externalKey(route.request().url())}.json`)
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: recorded ?? EMPTY_TILEJSON
      })
    })
  }

  return unexpected
}

function tryRead (relativePath) {
  try {
    return readFileSync(join(FIXTURES_DIR, relativePath))
  } catch {
    return undefined
  }
}
