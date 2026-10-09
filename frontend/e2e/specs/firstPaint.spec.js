import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "../support/test.js";
import { waitForMapReady } from "../support/appPage.js";
import { DEFAULT_VIEW, FROZEN_TIME } from "../support/constants.js";
import { FIXTURES_DIR } from "../support/fixturesDir.js";

const TRACK_TILES = /\/api\/tiles\/tracks\//;

// Keeps matching requests in flight until released, then hands them on to the
// mock router, which context.route runs after this handler.
async function hold(context, pattern) {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  await context.route(pattern, async (route) => {
    await gate;
    await route.fallback();
  });
  return release;
}

test.describe("the first paint", () => {
  // The same instant, but flowing. lodash's debounce times itself with
  // Date.now, so under the fixed clock the ramp measurement a hex 'sourcedata'
  // schedules never runs, and only 'idle', which the held tracks keep away,
  // could reveal the map.
  test.beforeEach(async ({ context }) => {
    await context.clock.setSystemTime(FROZEN_TIME);
  });

  test("clears the splash while track tiles are still loading", async ({
    page,
    context,
  }) => {
    const release = await hold(context, TRACK_TILES);
    try {
      await page.goto(`/${DEFAULT_VIEW}`);
      await waitForMapReady(page);
    } finally {
      release();
    }
  });

  test("counts datasets in view before the map settles", async ({
    page,
    context,
  }) => {
    // The stock fixture has no bboxes, so nothing in it is ever in view.
    const rows = JSON.parse(
      readFileSync(join(FIXTURES_DIR, "api/pointQuery.json"), "utf8"),
    );
    rows[0].filtered_bbox_geojson = {
      type: "Polygon",
      coordinates: [
        [
          [-96.9, 62.3],
          [-94.9, 62.3],
          [-94.9, 64.3],
          [-96.9, 64.3],
          [-96.9, 62.3],
        ],
      ],
    };
    await context.route(/\/api\/pointQuery/, (route) =>
      route.fulfill({ json: rows }),
    );
    const release = await hold(context, TRACK_TILES);
    try {
      await page.goto(`/${DEFAULT_VIEW}`);
      await waitForMapReady(page);
      await expect(page.getByTestId("counts-only-in-view")).toHaveText(
        "1 in view",
      );
    } finally {
      release();
    }
  });
});
