import { expect, test } from "../support/test.js";
import { waitForMapReady } from "../support/appPage.js";
import {
  CENTRE,
  CROSSED_MARKER,
  CROSSING_TRACK,
  LONE_MARKER,
  OPEN_TRACK,
  SHARED_MARKER,
  ZOOM,
} from "../support/syntheticScene.js";

// The one spec that points the mouse at the WebGL canvas itself, so hover and
// click ranking have a regression net that runs through MapLibre rather than
// around it. Every other spec asserts on the chrome and hides the canvas.
//
// Each test deep-links the camera so the spot it needs sits at the canvas
// centre: at zoom 2.75 the whole world is served by the four recorded z2 tiles,
// so any centre is covered without pixel maths. Both spots come from the
// recorded tiles in e2e/fixtures/tiles — re-recording them can move the hex.
//
// The recorded set is hexes only, so the marker tier has a hand-built scene
// instead (e2e/support/syntheticScene.js, encoded by build-synthetic-tiles.mjs):
// those tests open at its centre and aim at pixel offsets from there.

// Centroid of hex pk 23357 off Vancouver Island, inside that hex alone: 18
// days of data, and two of its four datasets are in the recorded pointQuery —
// the card lists only datasets in the current results.
const HEX = { lon: -123.9624, lat: 50.7718 };
// Inland, under no recorded hex.
const EMPTY = { lon: -105, lat: 60 };

// Not the shared app opener: that appends to the default view, whose own
// lat/lon would win.
const openAt = async (page, { lon, lat }, extra = "", zoom = 2.75) => {
  await page.goto(`/?lat=${lat}&lon=${lon}&zoom=${zoom}&lang=en${extra}`);
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

const openScene = (page) => openAt(page, CENTRE, "", ZOOM);

// A scene offset as a page coordinate.
const sceneAt = async (page, [dx, dy]) => {
  const { x, y } = await canvasCentre(page);
  return { x: x + dx, y: y + dy };
};

const midpoint = ({ from, to }) => [
  (from[0] + to[0]) / 2,
  (from[1] + to[1]) / 2,
];

// Tiles can land after first paint: repeat the gesture until it takes.
const hoverUntil = async (page, at, expectation) => {
  const { x, y } = await sceneAt(page, at);
  await expect(async () => {
    await page.mouse.move(x + 1, y);
    await page.mouse.move(x, y);
    await expectation();
  }).toPass({ timeout: 20_000 });
};

const clickUntil = async (page, at, expectation) => {
  const { x, y } = await sceneAt(page, at);
  await expect(async () => {
    await page.mouse.click(x, y);
    await expectation();
  }).toPass({ timeout: 20_000 });
};

const chip = (page) => page.locator(".mapChip");

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

test.describe("pointing at markers and tracks", () => {
  test("hovering a marker names its days of data", async ({ page }) => {
    await openScene(page);
    await hoverUntil(page, LONE_MARKER.at, () =>
      expect(chip(page)).toHaveText("12 day(s) of data", { timeout: 1_000 }),
    );
  });

  test("clicking a one-dataset marker opens that dataset", async ({ page }) => {
    await openScene(page);
    await clickUntil(page, LONE_MARKER.at, () =>
      expect(page).toHaveURL(/[?&]dataset=HakaiChlorophyllSampleProvisional/, {
        timeout: 1_000,
      }),
    );
    await expect(openCard(page)).toHaveCount(0);
  });

  test("clicking a shared marker lists both datasets as a station", async ({
    page,
  }) => {
    await openScene(page);
    await clickUntil(page, SHARED_MARKER.at, () =>
      expect(openCard(page)).toBeVisible({ timeout: 1_000 }),
    );
    const card = openCard(page);
    await expect(card).toContainText("40 day(s) of data");
    await expect(card.locator(".featureCardRow")).toHaveCount(2);
    // A marker is a place, not a neighbourhood: no "nearby" qualifier.
    await expect(card).not.toContainText("nearby");
  });

  test("hovering a track head names the trajectory", async ({ page }) => {
    await openScene(page);
    await hoverUntil(page, OPEN_TRACK.to, () =>
      expect(chip(page)).toContainText("ship-3", { timeout: 1_000 }),
    );
  });

  test("clicking a lone track draws that trajectory", async ({ page }) => {
    await openScene(page);
    await clickUntil(page, midpoint(OPEN_TRACK), () =>
      expect(page).toHaveURL(/[?&]track=ship-3/, { timeout: 1_000 }),
    );
    await expect(page).toHaveURL(
      /[?&]dataset=HakaiWaterPropertiesInstrumentProfileProvisional/,
    );
  });

  test("a marker on a track keeps the hover over its own circle", async ({
    page,
  }) => {
    await openScene(page);
    await hoverUntil(page, CROSSED_MARKER.at, () =>
      expect(chip(page)).toHaveText("5 day(s) of data", { timeout: 1_000 }),
    );
  });

  test("the track takes the hover just outside the drawn circle", async ({
    page,
  }) => {
    // Inside the marker's wide invisible hit stroke, but past the circle that
    // is actually drawn plus its grace: the track yields only to what shows.
    await openScene(page);
    const [x, y] = CROSSED_MARKER.at;
    await hoverUntil(page, [x + 11, y], () =>
      expect(chip(page)).toContainText(
        CROSSING_TRACK.properties.trajectory_id,
        {
          timeout: 1_000,
        },
      ),
    );
  });

  test("clicking a marker on a track lists the track first", async ({
    page,
  }) => {
    await openScene(page);
    await clickUntil(page, CROSSED_MARKER.at, () =>
      expect(openCard(page)).toBeVisible({ timeout: 1_000 }),
    );
    const rows = openCard(page).locator(".featureCardRow");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("glider-7");
  });
});
