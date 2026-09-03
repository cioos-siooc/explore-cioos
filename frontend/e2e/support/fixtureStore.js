import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fixtureKey } from './fixtureKey.js'
import { FIXTURES_DIR } from './fixturesDir.js'

// Reading fixtures off disk, with the fallback rule that keeps the fixture count
// sane. Used by the Playwright router and by the jsdom fetch stub, so a fixture
// recorded once answers in both suites.

function read (relativePath) {
  try {
    return readFileSync(join(FIXTURES_DIR, relativePath))
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Resolve a request to fixture bytes.
 *
 * Query-specific first, then the bare endpoint. Most endpoints (/platforms,
 * /organizations, /oceanVariables, …) answer the same thing whatever the query,
 * so only the handful whose response must differ under a filter — /pointQuery
 * and /legend, which is what makes the counts change — need a keyed variant.
 *
 * @returns { body, contentType } or undefined, which callers must treat as a
 *          loud failure naming `missingPath` rather than an empty response.
 */
export function resolveFixture (url) {
  const key = fixtureKey(url)

  if (key.isTile) {
    const body = read(key.path)
    return body
      ? {
        body,
        contentType: key.path.endsWith('.png')
          ? 'image/png'
          : 'application/x-protobuf'
      }
      // A tile with no recorded fixture is not an error: 204 is how MapLibre is
      // told "nothing here", and recording every tile of every view would be a
      // fixture set nobody could review.
      : { empty: true }
  }

  const body = read(key.path) ?? read(`api/${key.name}.json`)
  if (!body) return { missingPath: key.path }
  return { body, contentType: 'application/json' }
}

export { fixtureKey }
