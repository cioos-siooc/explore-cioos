import { defineConfig, devices } from '@playwright/test'

import { CHROMIUM_ARGS, VIEWPORTS } from './e2e/support/constants.js'

// The origin the app is told to call. It cannot resolve, which is the point:
// every request is answered from e2e/fixtures, and anything that escapes the
// router fails by name instead of quietly reaching a real deployment. Matches
// frontend/.env.test, which the dev server reads.
const API_ORIGIN = 'http://api.test'
// Deliberately not vite's dev default of 8000. reuseExistingServer would
// otherwise happily adopt a developer's own `npm run dev` — which runs in
// development mode against the real https://explore.cioos.ca/api — and the
// whole suite would pass while testing the wrong thing.
const PORT = 8010

export default defineConfig({
  testDir: './e2e',
  // Live smoke runs against a real stack and is selected explicitly, never by
  // the mocked projects.
  testIgnore: '**/*.live.spec.js',
  fullyParallel: true,
  // Every worker runs MapLibre on SwiftShader, which rasterises the whole map on
  // the CPU. Playwright's default of one worker per two cores oversubscribes the
  // machine badly enough that Chromium starts dropping requests
  // (net::ERR_NETWORK_CHANGED) and the map never finishes painting — which shows
  // up as unrelated-looking timeouts. Four is enough to keep the suite quick
  // without starving the renderers.
  workers: process.env.CI ? 2 : 4,
  forbidOnly: Boolean(process.env.CI),
  // One local retry, not zero. Chromium in a constrained environment
  // intermittently drops a request with net::ERR_NETWORK_CHANGED; the map then
  // never finishes painting and the failure reads as an unrelated timeout.
  // Playwright reports a test that only passed on retry as "flaky" rather than
  // as a pass, so this makes the noise visible without failing the run on it.
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  // One baseline set, not one per platform. With the default -{platform} suffix
  // a developer on macOS silently grows a second set CI never compares against
  // and both rot; with this, running the visual project natively off-Linux
  // produces a diff — the correct, loud signal to update through the same
  // container CI uses (npm run test:visual:update).
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{testFileName}/{arg}{ext}',

  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' }
  },

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    launchOptions: { args: CHROMIUM_ARGS }
  },

  projects: [
    // Behavioural specs run at the three viewport regimes the app branches on.
    ...Object.entries(VIEWPORTS).map(([name, viewport]) => ({
      name,
      testMatch: ['**/specs/*.spec.js'],
      testIgnore: [
        // Own projects, one viewport each.
        '**/specs/visual.spec.js',
        '**/specs/a11y.spec.js',
        // mobile.spec.js is about the phone layout specifically, so it belongs
        // to one project rather than being run three times at a viewport it
        // then overrides back to 390px anyway.
        ...(name === 'mobile' ? [] : ['**/specs/mobile.spec.js'])
      ],
      use: { ...devices['Desktop Chrome'], viewport }
    })),
    {
      name: 'visual',
      testMatch: '**/specs/visual.spec.js',
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORTS.desktop }
    },
    {
      name: 'a11y',
      testMatch: '**/specs/a11y.spec.js',
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORTS.desktop }
    },
    // No mock router and no webServer: this one asks whether a real stack,
    // built and served for real, actually works. It only exists when a base url
    // is configured, so a plain `npx playwright test` never tries to reach a
    // deployment that is not running.
    ...(process.env.LIVE_BASE_URL
      ? [
        {
          name: 'live',
          testMatch: '**/*.live.spec.js',
          testIgnore: [],
          use: {
            ...devices['Desktop Chrome'],
            viewport: VIEWPORTS.desktop,
            baseURL: process.env.LIVE_BASE_URL
          }
        }
      ]
      : [])
  ],

  // `--mode test` is what makes vite load .env.test, and therefore what points
  // the bundle at API_ORIGIN.
  webServer: process.env.LIVE_BASE_URL
    ? undefined
    : {
      command: `npm run dev:test -- --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { API_URL: `${API_ORIGIN}/api` }
    }
})

export { API_ORIGIN, PORT }
