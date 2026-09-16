import { expect, test as base } from "@playwright/test";

import { FROZEN_TIME } from "./constants.js";
import { installMockApi } from "./mockApi.js";

const API_ORIGIN = "http://api.test";

// Console noise that says nothing about this application, so the guard below
// reports on what is left rather than being all-or-nothing.
//
// Aborting an in-flight request is ordinary control flow here, not a failure:
// MapLibre cancels tile and source requests on every view change and whenever a
// source is removed, and the app cancels its own fetches in effect cleanups.
// The app already treats it as such wherever it can see it (src/state/reportError.js
// returns early on AbortError), but MapLibre's rejections surface at the window
// where no .catch can reach them. Every spec saw three to six of these, so the
// guard failed all 63 tests regardless of what they were asserting.
//
// Matched on the message rather than switched off: a genuine uncaught error
// still fails the spec it happens in. Add a pattern here only for noise that is
// provably outside this codebase's control.
const BENIGN_CONSOLE_ERRORS = [/^AbortError: /];

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
      await context.clock.setFixedTime(FROZEN_TIME);
      await use(FROZEN_TIME);
    },
    { auto: true },
  ],

  // The offline network, plus the assertion that nothing escaped it.
  mockApi: [
    async ({ context, baseURL }, use) => {
      const unexpected = await installMockApi(context, {
        appOrigin: new URL(baseURL).origin,
        apiOrigin: API_ORIGIN,
      });
      // UIProvider shows the intro modal unless this cookie is set, and it
      // covers everything. intro.spec.js clears it to test the modal itself.
      await context.addCookies([
        { name: "introModalOpen", value: "false", url: baseURL },
      ]);
      await use(unexpected);
      expect(unexpected, "requests with no fixture behind them").toEqual([]);
    },
    { auto: true },
  ],

  // The old puppeteer smoke test's one assertion, applied to every spec rather
  // than to a single page load.
  consoleGuard: [
    async ({ page }, use) => {
      const errors = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(String(error)));
      await use(errors);
      expect(
        errors.filter(
          (text) => !BENIGN_CONSOLE_ERRORS.some((p) => p.test(text)),
        ),
        "console errors during the test",
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
