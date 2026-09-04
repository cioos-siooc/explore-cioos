import { createHash } from 'node:crypto'

// How a request becomes a file on disk. Shared by the recorder that writes
// fixtures, the Playwright router that serves them, and the jsdom fetch stub
// that serves the same files to the unit suite — one keying rule, so a fixture
// recorded once answers in both tiers.

// Params that change on their own and would otherwise fragment the fixture set
// into one file per run. scrubTime and the time bounds ride along with almost
// every request and default to "today"; cache-busters are noise.
const VOLATILE_PARAMS = new Set(['scrubTime', 'nonce', '_', 'timeMax'])

/**
 * @param rawUrl  the full request url
 * @returns       { name, path } — `name` identifies the endpoint, `path` is the
 *                fixture file's path relative to e2e/fixtures/
 */
export function fixtureKey (rawUrl) {
  const url = new URL(rawUrl)
  const pathname = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '')

  // Tiles are addressed by their own coordinates, not by a query hash: the same
  // z/x/y is the same tile whatever else is on the query string, and keying them
  // any other way would need a fixture per filter combination per tile.
  const tile = /^(tiles(?:\/cells|\/tracks)?|nonna\/\d+)\/(\d+)\/(\d+)\/(\d+)\.(mvt|png)$/.exec(
    pathname
  )
  if (tile) {
    const [, kind, z, x, y, ext] = tile
    return {
      name: kind.replace(/\//g, '-'),
      path: `tiles/${kind.replace(/\//g, '-')}/${z}-${x}-${y}.${ext}`,
      isTile: true
    }
  }

  const name = (pathname || 'root').replace(/\//g, '_')
  const query = [...url.searchParams]
    .filter(([key, value]) => !VOLATILE_PARAMS.has(key) && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')

  if (!query) return { name, path: `api/${name}.json`, isTile: false }

  // Readable prefix so a fixture is recognisable in a directory listing and in a
  // diff, plus a hash so two different queries can never collide.
  const readable = query.replace(/[^A-Za-z0-9=,.-]/g, '_').slice(0, 48)
  const hash = createHash('sha1').update(query).digest('hex').slice(0, 8)
  return {
    name,
    path: `api/${name}__${readable}__${hash}.json`,
    isTile: false,
    query
  }
}

// Hosts the app loads basemap cartography from. Recorded and replayed rather
// than blocked: MapLibre logs errors without glyphs, and without a valid
// TileJSON the basemap source never loads — which is one of the conditions the
// first-paint signal waits on, so the splash would never lift.
export const EXTERNAL_HOSTS = new Set([
  'tiles.openfreemap.org',
  'tiles.emodnet-bathymetry.eu',
  'server.arcgisonline.com'
])

export function externalKey (rawUrl) {
  const url = new URL(rawUrl)
  const slug = `${url.host}${url.pathname}`.replace(/[^A-Za-z0-9.-]/g, '_')
  return `basemap/${slug}`
}
