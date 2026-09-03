// The one question the mocked suite cannot answer: does a real stack — the real
// API, a real database, the real built bundle behind nginx — actually serve a
// working page? Run against a live base url, with no fixtures and no routing:
//
//   LIVE_BASE_URL=http://localhost:8098 npm run test:e2e:live
//
// This replaces test/frontend_loads_without_errors.js, which did the same job
// under puppeteer. It is stricter than that script was: the original waited only
// for 'domcontentloaded' and then closed the browser immediately, so it could
// pass before the app had asked for anything. This waits for the map to paint.
import { expect, test } from '@playwright/test'

import { waitForMapReady, webglRenderer } from './support/appPage.js'

test('the deployed app loads without errors', async ({ page }) => {
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('requestfailed', (request) =>
    errors.push(`${request.failure()?.errorText} ${request.url()}`)
  )

  await page.goto('/')
  await waitForMapReady(page)

  expect(await webglRenderer(page), 'no WebGL context').toBeTruthy()
  await expect(page.getByTestId('top-bar')).toBeVisible()
  expect(errors).toEqual([])
})

test('the real api answers the catalogue queries', async ({ page, baseURL }) => {
  // The frontend cannot render a dataset list the API did not send, so a green
  // page with an empty catalogue is still a broken deployment.
  await page.goto('/')
  await waitForMapReady(page)

  const datasets = await page.request.get(`${baseURL}/api/datasets`)
  expect(datasets.ok(), 'GET /api/datasets').toBe(true)
  expect((await datasets.json()).length).toBeGreaterThan(0)
})
