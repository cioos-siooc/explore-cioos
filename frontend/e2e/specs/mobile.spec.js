import { expect, test } from "../support/test.js";
import { openApp } from "../support/appPage.js";
import { VIEWPORTS } from "../support/constants.js";

test.use({ viewport: VIEWPORTS.mobile });

test.describe("the phone layout", () => {
  test("leads with the map and keeps the list away", async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId("map-container")).toBeVisible();
    await expect(page.getByTestId("sidebar-datasets")).toHaveAttribute(
      "data-expanded",
      "false",
    );
  });

  test("never scrolls sideways", async ({ page }) => {
    await openApp(page);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow, "the page scrolls horizontally").toBeLessThanOrEqual(0);
  });

  test("opens the datasets list as a full-screen sheet", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("topbar-datasets-button").click();

    const sidebar = page.getByTestId("sidebar");
    await expect(sidebar).toBeVisible();

    const [sheet, viewport] = await Promise.all([
      sidebar.boundingBox(),
      page.viewportSize(),
    ]);
    expect(sheet.width).toBeGreaterThan(viewport.width * 0.9);
  });

  test("opens filters as a full-screen sheet", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("topbar-filters-button").click();

    const modal = page.getByTestId("filters-modal");
    await expect(modal).toBeVisible();
    const dialog = await modal.locator(".modal-content").boundingBox();
    expect(dialog.width).toBeGreaterThan(page.viewportSize().width * 0.9);
  });

  test("closes a sheet on Back, keeping what was chosen in it", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByTestId("topbar-filters-button").click();
    await page.locator('[data-filter-name="oceanVariablesFiltername"]').click();
    await page.getByTestId("filter-option").first().click();
    await expect(page).toHaveURL(/eovs=/);

    await page.goBack();

    await expect(page.getByTestId("filters-modal")).toHaveCount(0);
    await expect(page.getByTestId("map-container")).toBeVisible();
    await expect(page).toHaveURL(/eovs=/);
  });

  test("puts a sheet away when dragged down by its header", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByTestId("topbar-datasets-button").click();
    const sheet = page.getByTestId("sidebar-datasets");
    await expect(sheet).toHaveAttribute("data-expanded", "true");
    // Risen all the way, so the header is where it was measured.
    await expect(sheet).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");

    const header = await sheet.locator(".datasetsHeader").boundingBox();
    const x = header.x + header.width / 3;
    const y = header.y + header.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 300, { steps: 10 });
    await page.mouse.up();

    await expect(sheet).toHaveAttribute("data-expanded", "false");
  });

  test("keeps the top controls reachable", async ({ page }) => {
    await openApp(page);
    const bar = await page.getByTestId("top-bar").boundingBox();
    expect(bar.x).toBeGreaterThanOrEqual(0);
    expect(bar.x + bar.width).toBeLessThanOrEqual(
      page.viewportSize().width + 1,
    );
  });
});

test("names every quick filter on its button, and still fits the width", async ({
  page,
}) => {
  await openApp(page);
  const row = page.getByTestId("quick-filters");
  for (const [testId, caption] of [
    ["quick-filter-area", "Area"],
    ["quick-filter-in-view", "In view"],
    ["quick-filter-realtime", "Real-time"],
  ]) {
    await expect(
      row.getByTestId(testId).locator(".quickFilterCaption"),
    ).toHaveText(caption);
    await expect(
      row.getByTestId(testId).locator(".quickFilterCaption"),
    ).toBeVisible();
  }
  await expect(row.getByTestId("quick-filter-reset")).toHaveAccessibleName(
    /clear all filters/i,
  );
  const tops = await row
    .locator(".quickFilterButton")
    .evaluateAll((buttons) =>
      buttons.map((b) => b.getBoundingClientRect().top),
    );
  expect(new Set(tops).size, "the quick filters wrap").toBe(1);

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, "the page scrolls horizontally").toBeLessThanOrEqual(0);
});

// Landscape phones miss the width rung but are too short for floating chrome.
test.describe("a phone held landscape", () => {
  test.use({ viewport: { width: 844, height: 390 } });

  test("gets the full-screen datasets sheet with rows in it", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByTestId("topbar-datasets-button").click();

    const sidebar = page.getByTestId("sidebar");
    const sheet = await sidebar.boundingBox();
    expect(sheet.width).toBeGreaterThan(page.viewportSize().width * 0.9);
    await expect(sidebar.getByTestId("dataset-card").first()).toBeInViewport();
  });

  test("keeps the filters footer on screen", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("topbar-filters-button").click();

    await expect(
      page.getByTestId("filters-modal").getByRole("button", {
        name: "Clear all",
      }),
    ).toBeInViewport();
  });
});
