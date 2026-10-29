import { expect, test } from "../support/test.js";
import { waitForMapReady } from "../support/appPage.js";
import {
  CENTRE,
  CROSSED_MARKER,
  CROSSING_TRACK,
  GRID_A,
  GRID_A_ONLY,
  GRID_OVERLAP,
  LONE_MARKER,
  OPEN_TRACK,
  SHARED_MARKER,
  ZOOM,
  lngLatAt,
} from "../support/syntheticScene.js";

// The only spec driving the WebGL canvas itself. At zoom 2.75 the four
// recorded z2 tiles cover the world, so each test deep-links its spot to the
// canvas centre; re-recording e2e/fixtures/tiles can move the hex. Recorded
// tiles are hexes only, so marker tests use the synthetic scene instead.

// On a two-core runner the map takes ~12s to be ready and each drawing click
// ~2s, past the default 30s.
test.slow();

// Hex pk 23357: 18 days, and two of its four datasets are in the recorded
// pointQuery (the card lists only datasets in the current results).
const HEX = { lon: -123.9624, lat: 50.7718 };
// Inland, under no recorded hex.
const EMPTY = { lon: -105, lat: 60 };

// Not the shared opener: the default view's own lat/lon would win.
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

const openScene = (page, extra = "") => openAt(page, CENTRE, extra, ZOOM);

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

  test("a hex tile that fails once is fetched again", async ({
    page,
    consoleGuard,
  }) => {
    // HEX's z2 tile.
    const tile = /\/tiles\/2\/0\/1\.mvt/;
    let requests = 0;
    await page.route(tile, (route) => {
      requests += 1;
      if (requests === 1) return route.fulfill({ status: 500, body: "" });
      return route.fallback();
    });
    await openAt(page, HEX);
    const { x, y } = await canvasCentre(page);
    await expect(async () => {
      await page.mouse.move(x + 1, y);
      await page.mouse.move(x, y);
      await expect(page.locator(".mapChip")).toHaveText("18 day(s) of data", {
        timeout: 1_000,
      });
    }).toPass({ timeout: 20_000 });
    expect(requests).toBe(2);
    // The failure this test injects, logged by the browser and by MapLibre.
    const injected = /\b500\b/;
    expect(consoleGuard.some((text) => injected.test(text))).toBe(true);
    consoleGuard.splice(
      0,
      consoleGuard.length,
      ...consoleGuard.filter((text) => !injected.test(text)),
    );
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

  test("the legend's depth tool labels the clicked depth, until Esc", async ({
    page,
  }, testInfo) => {
    // Halifax approaches; the depth is e2e/fixtures/api/depth.json's.
    await openAt(page, { lon: -63.55, lat: 44.62 }, "", 12);
    const { x, y } = await canvasCentre(page);
    const probe = page.getByTestId("depth-probe");

    // Off by default: a plain click reads nothing. The wait outlasts Map.jsx's
    // TAP_ECHO_MS, which would drop the next click as this one's echo.
    await page.mouse.click(x, y);
    await page.waitForTimeout(500);
    await expect(probe).toHaveCount(0);

    // On a phone the depth group sits in the legend's dialog, which the tool
    // closes on its way on.
    const inDialog = testInfo.project.name === "mobile";
    if (inDialog) await page.getByRole("button", { name: "Legend" }).click();
    const tool = page.getByRole("button", { name: "Read the depth at a point" });
    await tool.click();
    if (inDialog) await expect(page.getByRole("dialog")).toHaveCount(0);
    else await expect(tool).toHaveAttribute("aria-pressed", "true");
    await page.mouse.click(x, y);
    await expect(probe).toContainText("26.4 m");
    await expect(probe).toContainText("CHS NONNA · 10 m grid");
    await expect(page.locator(".depthProbeDot")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(probe).toHaveCount(0);
    if (!inDialog) await expect(tool).toHaveAttribute("aria-pressed", "false");
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

  test("closing the dataset a marker opened leaves it closed", async ({
    page,
  }) => {
    // On a phone the list rises over the page the click opened. Closing the
    // page from there must not hand Back an entry that reopens it.
    await openScene(page);
    await clickUntil(page, LONE_MARKER.at, () =>
      expect(page).toHaveURL(/[?&]dataset=/, { timeout: 1_000 }),
    );
    await page.getByTestId("sidebar-close-dataset").click();
    await expect(page).not.toHaveURL(/[?&]dataset=/);
    await page.waitForTimeout(1_000);
    await expect(page).not.toHaveURL(/[?&]dataset=/);
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

test.describe("pointing at gridded coverage", () => {
  test("hovering one grid names it", async ({ page }) => {
    await openScene(page, "&griddap=true");
    await hoverUntil(page, GRID_A_ONLY, () =>
      expect(chip(page)).toHaveText(GRID_A.properties.title_translated.en, {
        timeout: 1_000,
      }),
    );
  });

  test("hovering stacked grids counts them", async ({ page }) => {
    await openScene(page, "&griddap=true");
    await hoverUntil(page, GRID_OVERLAP, () =>
      expect(chip(page)).toHaveText("2 gridded datasets", { timeout: 1_000 }),
    );
  });

  test("a marker keeps the hover over a grid", async ({ page }) => {
    await openScene(page, "&griddap=true");
    await hoverUntil(page, CROSSED_MARKER.at, () =>
      expect(chip(page)).toHaveText("5 day(s) of data", { timeout: 1_000 }),
    );
  });

  test("clicking stacked grids lists each once", async ({ page }) => {
    await openScene(page, "&griddap=true");
    await clickUntil(page, GRID_OVERLAP, () =>
      expect(openCard(page)).toBeVisible({ timeout: 1_000 }),
    );
    const rows = openCard(page).locator(".featureCardRow");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("Gridded dataset");
  });
});

test.describe("the selected track", () => {
  test("a fix of the drawn track outranks the track line under it", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile",
      "the dataset page covers the map on a phone",
    );
    await openScene(page);
    const middle = midpoint(OPEN_TRACK);
    await clickUntil(page, middle, () =>
      expect(page).toHaveURL(/[?&]track=ship-3/, { timeout: 1_000 }),
    );
    // The middle fix sits on the tile track's line. Its chip carries the
    // fix's own time; the line's would name the trajectory instead.
    await hoverUntil(page, middle, () =>
      expect(chip(page)).toContainText("2026-01-07 12:00Z", {
        timeout: 1_000,
      }),
    );
    await expect(chip(page)).not.toContainText("ship-3");
  });
});

test.describe("drawing a spatial filter", () => {
  const near = (value, expected) =>
    expect(Math.abs(Number(value) - expected)).toBeLessThan(0.02);

  test("a box drawn on the map becomes the filter", async ({ page }) => {
    await openScene(page);
    await page.getByTestId("quick-filter-area").click();
    await page.getByTestId("quick-filter-area-box").click();
    const from = await sceneAt(page, [-100, -60]);
    const to = await sceneAt(page, [100, 60]);
    await page.mouse.click(from.x, from.y);
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await page.mouse.click(to.x, to.y);
    await expect(page).toHaveURL(/[?&]latMin=/);
    const params = new URL(page.url()).searchParams;
    const [west, north] = lngLatAt([-100, -60]);
    const [east, south] = lngLatAt([100, 60]);
    near(params.get("lonMin"), west);
    near(params.get("lonMax"), east);
    near(params.get("latMin"), south);
    near(params.get("latMax"), north);
  });

  test("clicking while drawing adds a vertex, not a card", async ({ page }) => {
    await openScene(page);
    await page.getByTestId("quick-filter-area").click();
    await page.getByTestId("quick-filter-area-polygon").click();
    // Paced like a person: mapbox-gl-draw only knows the first vertex is under
    // the cursor once it has redrawn after a move, so a closing click that
    // lands in the same frame as the last one misses it.
    const clickAt = async (at) => {
      const { x, y } = await sceneAt(page, at);
      await page.mouse.move(x, y, { steps: 4 });
      await page.waitForTimeout(150);
      await page.mouse.click(x, y);
    };
    for (const at of [SHARED_MARKER.at, [90, 100], [-60, 100]]) {
      await clickAt(at);
    }
    await expect(openCard(page)).toHaveCount(0);
    // Closing the ring on its first vertex finishes the shape.
    await clickAt(SHARED_MARKER.at);
    await expect(page).toHaveURL(/[?&]polygon=/);
    await expect(openCard(page)).toHaveCount(0);
  });

  test("a shared box comes back editable, and stays a box", async ({
    page,
  }) => {
    const [west, north] = lngLatAt([-100, -60]);
    const [east, south] = lngLatAt([100, 60]);
    await openScene(
      page,
      `&latMin=${south}&lonMin=${west}&latMax=${north}&lonMax=${east}`,
    );
    // Only a shape the draw control holds has corners to drag: moving one
    // rewrites the bounds, and the rectangle mode drags its neighbours along
    // so it never turns into a free-form polygon.
    // One drag, not a retried one: the bounds land a debounce after mouseup,
    // and a second drag would start from where the corner used to be.
    const corner = await sceneAt(page, [100, -60]);
    const target = await sceneAt(page, [130, -90]);
    await page.mouse.move(corner.x, corner.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await page.mouse.up();
    const lonMax = () => new URL(page.url()).searchParams.get("lonMax");
    await expect
      .poll(() => Math.abs(lonMax() - lngLatAt([130, -90])[0]))
      .toBeLessThan(0.02);
    const params = new URL(page.url()).searchParams;
    near(params.get("latMax"), lngLatAt([130, -90])[1]);
    near(params.get("lonMin"), west);
    near(params.get("latMin"), south);
    expect(params.has("polygon")).toBe(false);
  });
});
