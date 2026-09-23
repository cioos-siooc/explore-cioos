import { expect, test } from "../support/test.js";
import { waitForMapReady } from "../support/appPage.js";

// The one spec that points the mouse at the WebGL canvas itself, so hover and
// click ranking have a regression net that runs through MapLibre rather than
// around it. Every other spec asserts on the chrome and hides the canvas.
//
// Each test deep-links the camera so the spot it needs sits at the canvas
// centre: at zoom 2.75 the whole world is served by the four recorded z2 tiles,
// so any centre is covered without pixel maths. Both spots come from the
// recorded tiles in e2e/fixtures/tiles — re-recording them can move the hex.

// Centroid of hex pk 23357 off Vancouver Island, inside that hex alone: 18
// days of data, and two of its four datasets are in the recorded pointQuery —
// the card lists only datasets in the current results.
const HEX = { lon: -123.9624, lat: 50.7718 };
// Inland, under no recorded hex.
const EMPTY = { lon: -105, lat: 60 };

// Not the shared app opener: that appends to the default view, whose own
// lat/lon would win.
const openAt = async (page, { lon, lat }, extra = "") => {
  await page.goto(`/?lat=${lat}&lon=${lon}&zoom=2.75&lang=en${extra}`);
  await waitForMapReady(page);
  // The card stands aside while the datasets sidebar is open, and the sidebar
  // starts open on a wide screen.
  const sidebar = page.getByTestId("sidebar-datasets");
  if ((await sidebar.getAttribute("data-expanded")) === "true") {
    await page.getByTestId("topbar-datasets-button").click();
    await expect(sidebar).toHaveAttribute("data-expanded", "false");
  }
};

const canvasCentre = async (page) => {
  const box = await page.locator(".maplibregl-canvas").boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const openCard = (page) => page.locator('[data-testid="feature-card"].open');

const expectHexCard = async (page) => {
  const card = openCard(page);
  await expect(card).toContainText("18 day(s) of data");
  await expect(card).toContainText("Bulk and Size-Fractionated Chlorophyll");
  await expect(card).toContainText(
    "Water Property Measurements from Conductivity-Temperature-Depth",
  );
};

test.describe("pointing at the map", () => {
  test("hovering a hex names its days of data", async ({ page }) => {
    await openAt(page, HEX);
    const { x, y } = await canvasCentre(page);
    // The tiles can land after first paint; wiggle until the hex is there.
    await expect(async () => {
      await page.mouse.move(x + 1, y);
      await page.mouse.move(x, y);
      await expect(page.locator(".mapChip")).toHaveText("18 day(s) of data", {
        timeout: 1_000,
      });
    }).toPass({ timeout: 20_000 });
  });

  test("hovering empty water shows nothing", async ({ page }) => {
    await openAt(page, EMPTY);
    const { x, y } = await canvasCentre(page);
    await page.mouse.move(x + 1, y);
    await page.mouse.move(x, y);
    await expect(page.locator(".mapChip")).toHaveCount(0);
  });

  test("clicking a hex opens the card on what it holds", async ({ page }) => {
    await openAt(page, HEX);
    const { x, y } = await canvasCentre(page);
    await expect(async () => {
      await page.mouse.click(x, y);
      await expect(openCard(page)).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await expectHexCard(page);
    // useUrlSync writes the click point, so the card survives as a link.
    await expect(page).toHaveURL(/[?&]at=-123\.96\d*(%2C|,)50\.77/);
  });

  test("a shared link replays the click it was written from", async ({
    page,
  }) => {
    await openAt(page, EMPTY, `&at=${HEX.lon},${HEX.lat}`);
    await expect(openCard(page)).toBeVisible({ timeout: 20_000 });
    await expectHexCard(page);
  });

  test("clicking empty water closes the card", async ({ page }) => {
    await openAt(page, EMPTY, `&at=${HEX.lon},${HEX.lat}`);
    await expect(openCard(page)).toBeVisible({ timeout: 20_000 });
    const { x, y } = await canvasCentre(page);
    await page.mouse.click(x, y);
    await expect(openCard(page)).toHaveCount(0);
  });
});
