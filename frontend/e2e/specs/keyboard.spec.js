import { expect, test } from "../support/test.js";
import { openApp, waitForMapReady } from "../support/appPage.js";

// axe can't see Escape, arrow keys or where focus lands, so these walk the
// overlays by keyboard. test.fail() marks a gap the named step of
// docs/frontend-ui-audit.md closes; it errors once the gap is fixed, so the
// marker goes with the migration.

test.describe("keyboard", () => {
  test("a modal takes focus, closes on Escape and hands focus back", async ({
    page,
  }) => {
    await openApp(page);
    const trigger = page.getByTestId("topbar-filters-button");
    await trigger.focus();
    await page.keyboard.press("Enter");

    const modal = page.getByTestId("filters-modal");
    await expect(modal).toBeVisible();
    await expect(modal.locator(":focus")).toHaveCount(1);

    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("a menu opens on Enter, walks with arrows and closes on Escape", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByTestId("topbar-coverage-button").click();
    const trigger = page.getByTestId("coverage-count-dropdown-toggle");
    await trigger.focus();
    await page.keyboard.press("Enter");

    const popup = page.locator('[role="menu"], [role="listbox"]');
    // A pick list opens on what is picked.
    const checked = popup.locator(
      '[aria-checked="true"], [aria-selected="true"]',
    );
    await expect(checked).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(checked).not.toBeFocused();
    await expect(popup.locator(":focus")).toHaveCount(1);

    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);
    await expect(trigger).toBeFocused();
    // One layer at a time: the modal under the menu stays open.
    await expect(page.getByTestId("coverage-modal")).toBeVisible();
  });

  test("the map's card takes focus and closes on Escape", async ({ page }) => {
    test.fail(true, "docs/frontend-ui-audit.md step 5: FeatureCard shell");
    // Canvas clicks are slow on a two-core runner; see mapInteraction.spec.js.
    test.slow();
    // The recorded hex mapInteraction.spec.js opens its card on.
    await page.goto("/?lat=50.7718&lon=-123.9624&zoom=2.75&lang=en");
    await waitForMapReady(page);
    const box = await page.locator(".maplibregl-canvas").boundingBox();
    const card = page.locator('[data-testid="feature-card"].open');
    await expect(async () => {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(card).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });

    await expect(card.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
  });
});
