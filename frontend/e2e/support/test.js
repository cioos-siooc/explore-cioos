import { expect, test as base } from "@playwright/test";

import { FROZEN_TIME } from "./constants.js";
import { installMockApi } from "./mockApi.js";

const API_ORIGIN = "http://api.test";

// MapLibre's cancelled requests reject at the window where no .catch reaches
// them. Add a pattern only for noise provably outside this codebase's control.
const BENIGN_CONSOLE_ERRORS = [/^AbortError: /];

export const test = base.extend({
  // Before any navigation: "now" picks which fixture answers. Left running, not
  // setFixedTime: lodash debounce reads Date.now(), and a frozen clock re-arms
  // every debounce forever.
  frozenClock: [
    async ({ context }, use) => {
      await context.clock.setSystemTime(FROZEN_TIME);
      await use(FROZEN_TIME);
    },
    { auto: true },
  ],

  mockApi: [
    async ({ context, baseURL }, use) => {
      const unexpected = await installMockApi(context, {
        appOrigin: new URL(baseURL).origin,
        apiOrigin: API_ORIGIN,
      });
      // The intro modal and tips would otherwise cover the page mid-spec.
      await context.addInitScript(() => {
        window.localStorage.setItem("cde.introSeen", "true");
        window.localStorage.setItem("cde.tipsEnabled", "false");
      });
      await use(unexpected);
      expect(unexpected, "requests with no fixture behind them").toEqual([]);
    },
    { auto: true },
  ],

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
