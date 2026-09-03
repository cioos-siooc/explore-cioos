import { vi } from 'vitest'

import { resolveFixture } from '../../e2e/support/fixtureStore.js'

// The jsdom half of the mock network, reading the same e2e/fixtures/ the
// Playwright router serves. One fixture set for both suites: a payload recorded
// once answers a provider test and an end-to-end spec identically, so the two
// tiers can never disagree about what the API returns.
//
// Installed per test rather than globally — most unit tests are pure and should
// not have a network at all, and a component test that fetches unexpectedly is
// worth finding out about.

/**
 * @returns the array of urls that had no fixture behind them. Assert it empty
 *          where the test cares; the rejection alone already fails the render.
 */
export function installMockFetch () {
  const missing = []

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : input.url
      const fixture = resolveFixture(url)

      if (fixture.empty) return new Response(null, { status: 204 })
      if (fixture.missingPath) {
        missing.push(`${url}  (no fixture at ${fixture.missingPath})`)
        // 404 rather than a throw: fetchJson turns a non-2xx into the same
        // error the app sees from a real failure, so the component under test
        // takes its real error path instead of an artificial one.
        return new Response('missing fixture', { status: 404 })
      }
      return new Response(fixture.body, {
        status: 200,
        headers: { 'content-type': fixture.contentType }
      })
    })
  )

  return missing
}
