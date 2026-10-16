import { defineConfig, devices } from "@playwright/test";

import { CHROMIUM_ARGS, VIEWPORTS } from "./e2e/support/constants.js";

// Unresolvable on purpose: anything escaping the fixture router fails by name
// instead of reaching a real deployment. Matches frontend/.env.test.
const API_ORIGIN = "http://api.test";
// Not vite's 8000: reuseExistingServer would adopt a developer's own
// `npm run dev` against the real API and test the wrong thing.
const PORT = 8010;

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "**/*.live.spec.js",
  fullyParallel: true,
  // MapLibre rasterises on the CPU (SwiftShader); the default worker count
  // oversubscribes it until Chromium drops requests (net::ERR_NETWORK_CHANGED)
  // and tests time out for unrelated-looking reasons.
  workers: process.env.CI ? 2 : 4,
  forbidOnly: Boolean(process.env.CI),
  // One local retry for the same ERR_NETWORK_CHANGED drops; Playwright still
  // reports such a test as "flaky", so the noise stays visible.
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],

  // One baseline set, not one per platform: baselines are only valid against
  // CI's image, so visual/a11y scripts run through e2e/in-container.sh.
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{projectName}/{testFileName}/{arg}{ext}",

  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
      // Two consecutive captures must agree before comparing, and on CI's
      // SwiftShader that took longer than the 5s default (10/12 visual tests
      // timed out). Doesn't loosen the comparison itself.
      timeout: 20_000,
    },
  },

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    launchOptions: { args: CHROMIUM_ARGS },
  },

  projects: [
    ...Object.entries(VIEWPORTS).map(([name, viewport]) => ({
      name,
      testMatch: ["**/specs/*.spec.js"],
      testIgnore: [
        "**/specs/visual.spec.js",
        "**/specs/a11y.spec.js",
        // mobile.spec.js overrides to 390px anyway.
        ...(name === "mobile" ? [] : ["**/specs/mobile.spec.js"]),
      ],
      use: { ...devices["Desktop Chrome"], viewport },
    })),
    {
      name: "visual",
      testMatch: "**/specs/visual.spec.js",
      use: { ...devices["Desktop Chrome"], viewport: VIEWPORTS.desktop },
    },
    {
      name: "a11y",
      testMatch: "**/specs/a11y.spec.js",
      use: { ...devices["Desktop Chrome"], viewport: VIEWPORTS.desktop },
    },
    // Real stack, no mocks; only defined when LIVE_BASE_URL is set.
    ...(process.env.LIVE_BASE_URL
      ? [
          {
            name: "live",
            testMatch: "**/*.live.spec.js",
            testIgnore: [],
            use: {
              ...devices["Desktop Chrome"],
              viewport: VIEWPORTS.desktop,
              baseURL: process.env.LIVE_BASE_URL,
            },
          },
        ]
      : []),
  ],

  // `--mode test` makes vite load .env.test, pointing the bundle at API_ORIGIN.
  webServer: process.env.LIVE_BASE_URL
    ? undefined
    : {
        command: `npm run dev:test -- --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: { API_URL: `${API_ORIGIN}/api` },
      },
});

export { API_ORIGIN, PORT };
