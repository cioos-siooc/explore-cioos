// Record the fixture set the test suites replay, by driving a real browser
// against a live deployment.
//
//   node e2e/record-fixtures.mjs [--base=https://explore.cioos.ca] [--max-rows=40]
//
// Every state the specs need is deep-linkable (useUrlSync.js is the sole writer
// of the URL, and every provider seeds itself back out of it), so the recorder
// navigates by address and never has to know the UI. That is also why it stays
// correct as the chrome changes.
//
// Recorded payloads are real API responses, truncated to --max-rows so the
// committed JSON stays reviewable in a diff. Refresh with the same command; see
// e2e/fixtures/README.md for when that is worth doing.

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

import { EXTERNAL_HOSTS, externalKey, fixtureKey } from './support/fixtureKey.js'
import { CHROMIUM_ARGS, FROZEN_TIME, RECORDED_VIEWS } from './support/constants.js'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(here, 'fixtures')

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('='))
)
const BASE = args.base || 'https://explore.cioos.ca'
const MAX_ROWS = Number(args['max-rows'] || 40)

// Keep fixtures small enough to read. Only top-level arrays and the common
// { rows: [...] } envelope are truncated — nothing else is reshaped, so what is
// replayed still has the real payload's structure.
function truncate (value) {
  if (Array.isArray(value)) return value.slice(0, MAX_ROWS)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        Array.isArray(inner) ? inner.slice(0, MAX_ROWS) : inner
      ])
    )
  }
  return value
}

const written = new Set()

async function write (relativePath, body) {
  if (written.has(relativePath)) return
  written.add(relativePath)
  const target = join(FIXTURES, relativePath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, body)
  console.log('  wrote', relativePath, typeof body === 'string' ? '' : `(${body.length}b)`)
}

const browser = await chromium.launch({ args: CHROMIUM_ARGS })
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } })
// The same fixed clock the specs run under, so recorded query strings (which
// carry today's date as the default time bound) match what the specs request.
await context.clock.setFixedTime(FROZEN_TIME)
// The intro modal is dismissed in the specs too; recording with it up would
// capture a first-visit state the tests never reach.
await context.addCookies([
  { name: 'introModalOpen', value: 'false', url: BASE }
])

const page = await context.newPage()

const appOrigin = new URL(BASE).origin

page.on('response', async (response) => {
  const url = new URL(response.url())
  try {
    // Origin as well as path: Sentry's ingest endpoint is /api/<id>/envelope/
    // and the analytics beacon is /api/event, both of which a path-only test
    // would happily record as API fixtures.
    if (url.origin === appOrigin && url.pathname.startsWith('/api/')) {
      const key = fixtureKey(response.url())
      if (key.isTile) {
        await write(key.path, await response.body())
      } else {
        await write(key.path, JSON.stringify(truncate(await response.json()), null, 2))
      }
    } else if (EXTERNAL_HOSTS.has(url.host)) {
      const body = await response.body()
      const extension = url.pathname.endsWith('.pbf')
        ? '.pbf'
        : url.pathname.endsWith('.png')
          ? '.png'
          : '.json'
      await write(externalKey(response.url()) + extension, body)
    }
  } catch (error) {
    // A response body that has already been discarded (a redirect, an aborted
    // request) is not worth failing the whole recording over.
    console.warn('  skipped', url.pathname, '-', error.message)
  }
})

for (const [name, search] of Object.entries(RECORDED_VIEWS)) {
  console.log(`\nrecording "${name}" ${search}`)
  await page.goto(`${BASE}/${search}`, { waitUntil: 'domcontentloaded' })
  // Not a readiness assertion — the recorder wants everything the page asks
  // for, including whatever arrives after first paint.
  await page.waitForTimeout(12_000)
}

await browser.close()
console.log(`\n${written.size} fixtures written to e2e/fixtures/`)
