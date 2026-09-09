import { expect, test } from "../support/test.js";
import { openApp } from "../support/appPage.js";
import { VIEWPORTS } from "../support/constants.js";

// The WebGL canvas is taken out of every shot below. SwiftShader's raster is
// not bit-identical across drivers and MapLibre's tile fade is not fully
// deterministic, so including it would make these permanently red — and what
// actually regresses is the chrome around it: the sidebar, the chips, the
// legend, the modals, and above all the phone layout.
//
// Hidden rather than handed to toHaveScreenshot's `mask`: the canvas is a
// full-viewport underlay, and a mask paints the locator's bounding box with no
// regard for what floats above it — so masking the map filled every screenshot
// with solid magenta and the baselines asserted nothing at all. `visibility`
// rather than `display` keeps it in flow, so nothing above it moves.
async function settle(page) {
  // Belt and braces alongside the config's animations:'disabled' — that stops
  // CSS animations, this stops anything mid-transition at capture time.
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
