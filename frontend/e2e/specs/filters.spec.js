import { expect, test } from "../support/test.js";
import { openApp, waitForMapReady } from "../support/appPage.js";
import { DEFAULT_VIEW } from "../support/constants.js";

test.describe("filters", () => {
  test("open as a modal from the top bar", async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId("filters-modal")).toHaveCount(0);

    await page.getByTestId("topbar-filters-button").click();
    await expect(page.getByTestId("filters-modal")).toBeVisible();
    await expect(page.getByTestId("filters-panel-list")).toBeVisible();
  });

  test("names every filter row in full, French included", async ({ page }) => {
    // Not openApp: DEFAULT_VIEW already carries lang=en, and the first lang wins.
    await page.goto(`/${DEFAULT_VIEW.replace("lang=en", "lang=fr")}`);
    await waitForMapReady(page);
    await page.getByTestId("topbar-filters-button").click();

    const list = page.getByTestId("filters-panel-list");
    await expect(
      list.locator('[data-filter-name="layerSelectorLabel"] .badgeTitle'),
    ).toHaveText("Géométrie des jeux de données");
    const clipped = await list
      .locator(".badgeTitle")
      .evaluateAll((els) =>
        els
          .filter((el) => el.scrollWidth - el.clientWidth > 1)
          .map((el) => el.textContent),
      );
    expect(clipped, "filter names cut off by the list column").toEqual([]);
  });

  test("applying one narrows the map and says so", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("topbar-filters-button").click();

    // Open the ocean-variables filter and pick the first value it offers.
    await page.locator('[data-filter-name="oceanVariablesFiltername"]').click();
    const option = page.getByTestId("filter-option").first();
    const label = (await option.textContent()).trim();
    await option.click();

    // The three things applying a filter must do: mark the option, announce
    // itself as a chip, and end up in the address so the view can be shared.
    await expect(option).toHaveAttribute("data-selected", "true");
    await expect(
      page.locator('[data-filter-key="eovs"] [data-testid="filter-chip-item"]'),
    ).toContainText(label);
    await expect(page).toHaveURL(/eovs=/);
  });

  test("a filtered link comes back as the same view", async ({ page }) => {
    // The round trip that useUrlSync exists for: the URL is written from state,
    // and every provider seeds itself back out of it on the next load.
    await openApp(page, "eovs=oxygen");

    await expect(
      page.locator('[data-filter-key="eovs"] [data-testid="filter-chip-item"]'),
    ).toContainText("Oxygen");
    await expect(page.getByTestId("topbar-filter-count")).toHaveText("1");
  });

  test("dismissing the chip clears the filter and the param", async ({
    page,
  }) => {
    await openApp(page, "eovs=oxygen");
    const chip = page.locator('[data-filter-key="eovs"]');
    await expect(chip).toBeVisible();

    await chip.getByTestId("filter-chip-group-remove").click();

    await expect(chip).toHaveCount(0);
    await expect(page).not.toHaveURL(/eovs=oxygen/);
  });

  test("reset clears every filter at once", async ({ page }) => {
    await openApp(page, "eovs=oxygen&platforms=mooring");
    await expect(page.getByTestId("filter-chip-group")).toHaveCount(2);

    await page.getByTestId("quick-filter-reset").click();

    await expect(page.getByTestId("active-filter-chips")).toHaveCount(0);
  });
});
