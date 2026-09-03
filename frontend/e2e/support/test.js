import { expect, test as base } from '@playwright/test'

import { FROZEN_TIME } from './constants.js'
import { installMockApi } from './mockApi.js'

const API_ORIGIN = 'http://api.test'

// The test object every mocked spec imports. Three auto-fixtures, so no spec
// repeats setup and none can forget it.
export const test = base.extend({
  // Must run before any navigation. Everything in the app that means "now"
  // derives from the clock: defaultEndDate is evaluated at module load and the
  // trajectory scrub time defaults to today, so without this the query strings
  // the app sends — and therefore which fixture answers, and therefore any
  // screenshot showing a date — change at midnight.
  frozenClock: [
    async ({ context }, use) => {
      await context.clock.setFixedTime(FROZEN_TIME)
      await use(FROZEN_TIME)
    },
    { auto: true }
  ],

  // The offline network, plus the assertion that nothing escaped it.
  mockApi: [
    async ({ context, baseURL }, use) => {
      const unexpected = await installMockApi(context, {
        appOrigin: new URL(baseURL).origin,
        apiOrigin: API_ORIGIN
      })
      // UIProvider shows the intro modal unless this cookie is set, and it
      // covers everything. intro.spec.js clears it to test the modal itself.
      await context.addCookies([
        { name: 'introModalOpen', value: 'false', url: baseURL }
      ])
      await use(unexpected)
      expect(unexpected, 'requests with no fixture behind them').toEqual([])
    },
    { auto: true }
  ],

  // The old puppeteer smoke test's one assertion, applied to every spec rather
  // than to a single page load.
  consoleGuard: [
    async ({ page }, use) => {
      const errors = []
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })
      page.on('pageerror', (error) => errors.push(String(error)))
      await use(errors)
      expect(errors, 'console errors during the test').toEqual([])
    },
    { auto: true }
  ]
})

export { expect }
