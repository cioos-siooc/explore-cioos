import { expect, test } from "../support/test.js";
import { openApp } from "../support/appPage.js";

// The hint walks the draw tools' own steps, so it is driven through the real
// mapbox-gl-draw modes on the canvas rather than the unit tests' stand-in.
async function mapPoint(page, dx, dy) {
  const box = await page.getByTestId("map-container").boundingBox();
  return [box.x + box.width / 2 + dx, box.y + box.height / 2 + dy];
}

test.describe("drawing an area with a mouse", () => {
  test("guides a box from its first corner to done", async ({ page }) => {
    await openApp(page);
    const hint = page.getByTestId("draw-hint");
    await page.getByTestId("quick-filter-box").click();
    await expect(hint).toHaveText("Click one corner of the box.");

    await page.mouse.click(...(await mapPoint(page, -60, -40)));
    await expect(hint).toContainText("Click the opposite corner");
    await page.mouse.click(...(await mapPoint(page, 60, 40)));
    await expect(hint).toHaveText("Drag any corner to reshape it.");
    await expect(page.getByTestId("quick-filter-box")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(hint).toHaveCount(0, { timeout: 10_000 });
  });

  test("offers to finish a polygon once it has three points", async ({
    page,
  }) => {
    await openApp(page);
    const hint = page.getByTestId("draw-hint");
    await page.getByTestId("quick-filter-polygon").click();
    await expect(hint).toHaveText("Click to place the polygon's first point.");

    await page.mouse.click(...(await mapPoint(page, -60, 40)));
    await expect(hint).toContainText("Click to add the next point");
    await page.mouse.click(...(await mapPoint(page, 0, -50)));
    await page.mouse.click(...(await mapPoint(page, 60, 40)));
    await expect(hint).toContainText("press Enter");

    await page.keyboard.press("Enter");
    await expect(hint).toHaveText("Drag any corner to reshape it.");
    await expect(page.getByTestId("quick-filter-polygon")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("closes a polygon on a double-click", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("quick-filter-polygon").click();
    await page.mouse.click(...(await mapPoint(page, -60, 40)));
    await page.mouse.click(...(await mapPoint(page, 0, -50)));
    await page.mouse.dblclick(...(await mapPoint(page, 60, 40)));
    await expect(page.getByTestId("draw-hint")).toHaveText(
      "Drag any corner to reshape it.",
    );
    await expect(page.getByTestId("quick-filter-polygon")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

test.describe("drawing an area by touch", () => {
  test.use({ hasTouch: true, isMobile: true });

  test("stays docked, speaks of taps, and closes on a double-tap", async ({
    page,
  }) => {
    await openApp(page);
    const hint = page.getByTestId("draw-hint");
    await page.getByTestId("quick-filter-polygon").tap();
    await expect(hint).toHaveText("Tap to place the polygon's first point.");

    await page.touchscreen.tap(...(await mapPoint(page, -60, 40)));
    await expect(hint).toHaveText("Tap to add the next point.");
    await page.touchscreen.tap(...(await mapPoint(page, 0, -50)));
    await page.touchscreen.tap(...(await mapPoint(page, 60, 40)));
    await expect(hint).toHaveText(
      "Tap to add a point. Double-tap or tap the first point to finish.",
    );
    await expect(hint).toHaveClass(/drawHintDocked/);
    await expect(hint).toHaveCSS("text-align", "center");

    const last = await mapPoint(page, 0, 60);
    await page.touchscreen.tap(...last);
    await page.touchscreen.tap(...last);
    await expect(hint).toHaveText("Drag any corner to reshape it.");
    await expect(page.getByTestId("quick-filter-polygon")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
