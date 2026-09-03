import { describe, it, expect } from 'vitest'

import { server } from './config.js'

// config.js throws at import time when API_URL is falsy, so this file failing to
// import at all is the signal that the test environment is not supplying it —
// and nothing else in the suite could run either. Worth its own test because
// API_URL reaches the module by two different routes: vite's define{} rewrite of
// process.env.API_URL, and a real process.env under Vitest's SSR transform,
// which does not rewrite it. .env.test feeds the first, test.env the second.
describe('the API base url', () => {
  it('is the unresolvable host from .env.test, not a real deployment', () => {
    // If this ever reads explore.cioos.ca, .env.test has stopped being picked up
    // and the suite is one un-stubbed fetch away from hitting production.
    expect(server).toBe('http://api.test/api')
  })

  it('is absolute, which the MapLibre tile worker requires', () => {
    // A relative API_URL works for main-thread fetch() but throws inside the
    // worker, where there is no document.baseURI to resolve against.
    expect(() => new URL(server)).not.toThrow()
  })
})
