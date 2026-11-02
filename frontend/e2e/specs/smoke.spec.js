import { expect, test } from "../support/test.js";
import { openApp, waitForMapReady, webglRenderer } from "../support/appPage.js";
import { defaultMapBounds } from "../../src/components/config.js";

test.describe("the app boots", () => {
  test("paints the map and clears the splash", async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId("map-container")).toBeVisible();
    await expect(page.getByTestId("top-bar")).toBeVisible();
  });

  test("frames the whole default box on a link without a camera", async ({
    page,
  }) => {
    await page.goto("/?lang=en");
    await waitForMapReady(page);
    await expect(page).toHaveURL(/[?&]bounds=/);
    const [west, south, east, north] = new URL(page.url()).searchParams
      .get("bounds")
      .split(",")
      .map(Number);
    const [[boxWest, boxSouth], [boxEast, boxNorth]] = defaultMapBounds;
    // The fit lands on the box's tight sides to within float error.
    const slack = 1e-6;
    expect(west).toBeLessThanOrEqual(boxWest + slack);
    expect(south).toBeLessThanOrEqual(boxSouth + slack);
    expect(east).toBeGreaterThanOrEqual(boxEast - slack);
    expect(north).toBeGreaterThanOrEqual(boxNorth - slack);
  });

  test("has a real WebGL context", async ({ page }) => {
    // Otherwise the suite goes green rendering nothing (see CHROMIUM_ARGS).
    await openApp(page);
    expect(
      await webglRenderer(page),
      "no WebGL context — check the swiftshader flags",
    ).toBeTruthy();
  });

  test("serves every request from a fixture", async ({ page, mockApi }) => {
    await openApp(page);
    expect(mockApi).toEqual([]);
  });

  test("leaves no cookie behind", async ({ page, context }) => {
    // The privacy notice promises no cookies.
    await openApp(page);
    expect(await context.cookies()).toEqual([]);
  });

  test("reproduces the view named in the address", async ({ page }) => {
    await openApp(page, "eovs=oxygen");
    await expect(page.getByTestId("active-filter-chips")).toBeVisible();
    await expect(
      page.locator('[data-filter-key="eovs"] [data-testid="filter-chip-item"]'),
    ).toContainText("Oxygen");
  });
});
