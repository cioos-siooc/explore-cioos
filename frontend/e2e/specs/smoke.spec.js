import { expect, test } from "../support/test.js";
import { openApp, webglRenderer } from "../support/appPage.js";

test.describe("the app boots", () => {
  test("paints the map and clears the splash", async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId("map-container")).toBeVisible();
    await expect(page.getByTestId("top-bar")).toBeVisible();
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
