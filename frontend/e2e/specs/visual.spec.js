import { expect, test } from "../support/test.js";
import { openApp } from "../support/appPage.js";
import { VIEWPORTS } from "../support/constants.js";

// The canvas is hidden: SwiftShader's raster isn't bit-identical across drivers.
// Not `mask`, which paints over everything floating above the full-viewport
// canvas; `visibility` rather than `display` keeps layout unchanged.
async function settle(page) {
  // animations:'disabled' doesn't stop transitions caught mid-way.
  await page.addStyleTag({
    content: `
      *,*::before,*::after{animation:none!important;transition:none!important}
      .maplibregl-canvas{visibility:hidden!important}
    `,
  });
}

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(name, () => {
    test.use({ viewport });

    test("the default view", async ({ page }) => {
      await openApp(page);
      await settle(page);
      await expect(page).toHaveScreenshot(`${name}-default.png`);
    });

    test("the datasets list open", async ({ page }) => {
      await openApp(page);
      const panel = page.getByTestId("sidebar-datasets");
      if ((await panel.getAttribute("data-expanded")) !== "true") {
        await page.getByTestId("topbar-datasets-button").click();
      }
      await expect(page.getByTestId("dataset-card").first()).toBeVisible();
      await settle(page);
      await expect(page).toHaveScreenshot(`${name}-sidebar.png`);
    });

    test("the filters modal", async ({ page }) => {
      await openApp(page);
      await page.getByTestId("topbar-filters-button").click();
      await expect(page.getByTestId("filters-panel-list")).toBeVisible();
      await settle(page);
      await expect(page).toHaveScreenshot(`${name}-filters.png`);
    });

    test("active filter chips", async ({ page }) => {
      await openApp(page, "eovs=oxygen&platforms=mooring");
      await expect(page.getByTestId("filter-chip-group")).toHaveCount(2);
      await settle(page);
      await expect(page).toHaveScreenshot(`${name}-chips.png`);
    });
  });
}
