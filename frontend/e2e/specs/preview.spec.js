import { expect, test } from "../support/test.js";
import { openApp } from "../support/appPage.js";
import { resolveFixture } from "../support/fixtureStore.js";

// The record preview modal, opened the way a shared link opens it: every plot
// setting is a query param, so an address is a complete description of the plot.
//
// The recorded /preview fixture is an empty array, so this spec declares the
// payload it needs. Playwright runs route handlers in reverse registration
// order, so a route added here wins over the one installMockApi registered.

const DATASET = "HakaiADCPTimeSeriesProfileProvisional";
const RECORD = "STATION_001-21/05/20-23:01:41";

const rows = Array.from({ length: 12 }, (_, i) => [
  i + 1,
  `2021-05-20T23:0${i % 10}:41Z`,
  1478 + i * 0.4,
  30 + i * 0.1,
  RECORD,
]);

const PREVIEW = {
  table: {
    columnNames: ["depth", "time", "SVELCV01", "PSALST01", "profile"],
    columnTypes: ["float", "String", "float", "float", "String"],
    columnUnits: ["m", "UTC", "m s-1", "PSU", null],
    rows,
  },
};

const plot = (page) => page.locator(".datasetPreviewPlotArea .main-svg");

async function openPreview(page, extra = "") {
  await page.route("**/preview?*", (route) => route.fulfill({ json: PREVIEW }));
  await openApp(
    page,
    `dataset=${DATASET}&preview=${encodeURIComponent(RECORD)}${extra}`,
  );
  await expect(page.getByRole("dialog")).toBeVisible();
}

test.describe("record preview", () => {
  test("a link opens the modal straight onto the plot", async ({ page }) => {
    await openPreview(page);

    await expect(page.getByText(RECORD, { exact: true })).toBeVisible(); // not the plot's "Profile: <record>" heading
    await expect(plot(page).first()).toBeVisible();
    // A profile type opens on the plot, so nothing about the view is in the URL.
    expect(new URL(page.url()).searchParams.get("vis")).toBeNull();
  });

  test("a changed setting rides the URL, and a default stays out of it", async ({
    page,
  }) => {
    await openPreview(page);
    await expect(plot(page).first()).toBeVisible();

    const modeToggle = page.getByTestId("preview-mode-dropdown-toggle");
    const mode = (name) =>
      page.getByTestId("preview-mode-option").getByText(name, { exact: true });

    await expect(modeToggle).toHaveText("Markers + Line");
    await modeToggle.click();
    await mode("Markers").click();

    await expect(modeToggle).toHaveText("Markers");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("pmode"))
      .toBe("markers");

    // Back to the default and the param goes, rather than being pinned at it.
    await modeToggle.click();
    await mode("Markers + Line").click();

    await expect(modeToggle).toHaveText("Markers + Line");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("pmode"))
      .toBeNull();
  });

  test("a setting survives the Table/Plot flip that unmounts the plot", async ({
    page,
  }) => {
    await openPreview(page, "&pmode=lines");
    await expect(plot(page).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Line" })).toBeVisible();

    await page.getByRole("button", { name: "Table" }).click();
    await expect(plot(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Plot" }).click();

    await expect(plot(page).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Line" })).toBeVisible();
  });

  test("closing clears the record and every plot param with it", async ({
    page,
  }) => {
    await openPreview(page, "&pmode=lines&pz=PSALST01");
    await expect(plot(page).first()).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect
      .poll(() => {
        const params = new URL(page.url()).searchParams;
        return ["preview", "pmode", "pz"].map((name) => params.get(name));
      })
      .toEqual([null, null, null]);
    // The dataset page it was opened from is still open behind it.
    expect(new URL(page.url()).searchParams.get("dataset")).toBe(DATASET);
  });
});

// Long long_names, the ones that collided in practice: wrapped to three lines,
// they used to climb into the figure title and run past their colour bars.
const LONG_LABELS = {
  table: {
    columnNames: ["depth", "time", "CHLA", "PSAL", "SIGT", "profile"],
    columnTypes: ["float", "String", "float", "float", "float", "String"],
    columnUnits: ["m", "UTC", "mg m-3", "PSU", "kg m-3", null],
    columnMeta: [
      {
        long_name:
          "Depth (spatial coordinate) relative to water surface in the water body",
        axis: "Z",
        positive: "down",
      },
      { long_name: "Time" },
      {
        long_name:
          "Concentration of chlorophyll-a {chl-a CAS 479-61-8} per unit volume of the water body [particulate >unknown phase] by in-situ chlorophyll fluorometer",
      },
      {
        long_name:
          "Practical salinity of the water body by CTD and computation using UNESCO 1983 algorithm",
      },
      {
        long_name:
          "Sigma-T of the water body by computation from salinity and temperature",
      },
      { long_name: "Profile", cf_role: "profile_id" },
    ],
    rows: Array.from({ length: 12 }, (_, i) => [
      i * 5,
      `2021-05-20T23:0${i % 10}:41Z`,
      0.1 + i * 0.01,
      31 + i * 0.2,
      25 + i * 0.1,
      RECORD,
    ]),
  },
};

// Only a Profile draws its record title inside the figure, above the panel
// titles, and no recorded dataset is one. Only a TimeSeriesProfile or a
// TrajectoryProfile is offered the colour plot.
async function serveLongLabelProfile(page, cdmDataType = "Profile") {
  await page.route("**/pointQuery*", (route) => {
    const datasets = JSON.parse(resolveFixture(route.request().url()).body);
    return route.fulfill({
      json: datasets.map((dataset) =>
        dataset.dataset_id === DATASET
          ? { ...dataset, cdm_data_type: cdmDataType }
          : dataset,
      ),
    });
  });
  await page.route("**/preview?*", (route) =>
    route.fulfill({ json: LONG_LABELS }),
  );
}

// Every title Plotly drew — the figure's, each axis's, each colour bar's, and
// the pinned shared axis's in its own strip — as the boxes the browser actually
// laid them out in. Each must stay inside its own figure, and no two may meet.
const labelOverlaps = (page) =>
  page.evaluate(() => {
    const boxes = [".datasetPreviewPlotArea", ".pinnedAxis"].flatMap(
      (selector) => {
        const container = document.querySelector(selector);
        const svg = container && container.querySelector(".main-svg");
        if (!svg) return [];
        const figure = svg.getBoundingClientRect();
        return [...container.querySelectorAll(".infolayer text")]
          .filter((text) => /title$/.test(text.getAttribute("class") || ""))
          .filter((text) => text.textContent.trim())
          .map((text) => ({
            name: `${selector} ${text.getAttribute("class")}`,
            rect: text.getBoundingClientRect(),
            figure,
          }));
      },
    );
    const TOLERANCE_PX = 1;
    const intersect = (a, b) =>
      a.left < b.right - TOLERANCE_PX &&
      b.left < a.right - TOLERANCE_PX &&
      a.top < b.bottom - TOLERANCE_PX &&
      b.top < a.bottom - TOLERANCE_PX;
    const problems = [];
    boxes.forEach((box, index) => {
      const { rect, figure } = box;
      if (
        rect.left < figure.left - TOLERANCE_PX ||
        rect.right > figure.right + TOLERANCE_PX ||
        rect.top < figure.top - TOLERANCE_PX ||
        rect.bottom > figure.bottom + TOLERANCE_PX
      ) {
        problems.push(`${box.name} leaves the figure`);
      }
      boxes.slice(index + 1).forEach((other) => {
        if (intersect(rect, other.rect)) {
          problems.push(`${box.name} overlaps ${other.name}`);
        }
      });
    });
    return { count: boxes.length, problems };
  });

test.describe("record preview labels", () => {
  test.beforeEach(({ page }) => serveLongLabelProfile(page));

  test("a profile's panel titles never reach the figure title", async ({
    page,
  }) => {
    await openApp(
      page,
      `dataset=${DATASET}&preview=${encodeURIComponent(RECORD)}&pvars=CHLA,PSAL,SIGT`,
    );
    await expect(plot(page).first()).toBeVisible();
    // The figure title, the depth axis and three panel titles.
    await expect
      .poll(() => labelOverlaps(page))
      .toEqual({ count: 5, problems: [] });
  });

  test("a colour plot's bar titles stay beside their own bars", async ({
    page,
  }) => {
    await serveLongLabelProfile(page, "TimeSeriesProfile"); // routed after the beforeEach's Profile, so it wins
    await openApp(
      page,
      `dataset=${DATASET}&preview=${encodeURIComponent(RECORD)}&playout=color&pvars=CHLA,PSAL,SIGT`,
    );
    await expect(plot(page).first()).toBeVisible();
    // The time axis, three depth axes and three bars; the record title sits
    // above the figure.
    await expect
      .poll(() => labelOverlaps(page))
      .toEqual({ count: 7, problems: [] });
  });
});

// The pinned strip, read against the panels it labels: whether the scroller
// really overflows, whether every strip label is on screen, and whether every
// gridline of the panels has a strip label on it.
const pinnedAxisState = (page, letter) =>
  page.evaluate((axisLetter) => {
    const scroller = document.querySelector(".datasetPreviewPlotArea");
    const along = axisLetter === "x" ? "left" : "top";
    const centre = (rect) =>
      axisLetter === "x"
        ? (rect.left + rect.right) / 2
        : (rect.top + rect.bottom) / 2;
    const labels = [
      ...document.querySelectorAll(`.pinnedAxis .${axisLetter}tick text`),
    ].map((text) => ({
      text: text.textContent,
      rect: text.getBoundingClientRect(),
    }));
    const gridlines = [
      ...scroller.querySelectorAll(`.gridlayer .${axisLetter}grid`),
    ].map((path) => path.getBoundingClientRect()[along]);
    const visible = labels.every(
      ({ rect }) =>
        rect.width > 0 &&
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= window.innerHeight &&
        rect.right <= window.innerWidth,
    );
    const ALIGN_PX = 2;
    const offGrid = gridlines.filter(
      (position) =>
        !labels.some(
          ({ rect }) => Math.abs(centre(rect) - position) <= ALIGN_PX,
        ),
    );
    return {
      overflows:
        axisLetter === "x"
          ? scroller.scrollHeight > scroller.clientHeight
          : scroller.scrollWidth > scroller.clientWidth,
      ticks: labels.map(({ text }) => text).join("|"),
      labelled: labels.length >= 2 && gridlines.length >= 2,
      visible,
      offGrid: offGrid.length,
    };
  }, letter);

test.describe("record preview pinned axis", () => {
  test.beforeEach(({ page }) => serveLongLabelProfile(page));

  test("a stack's bottom axis stays in view while its panels scroll", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await serveLongLabelProfile(page, "TimeSeriesProfile"); // routed after the beforeEach's Profile, so it wins
    await openApp(
      page,
      `dataset=${DATASET}&preview=${encodeURIComponent(RECORD)}&playout=color&pvars=CHLA,PSAL,SIGT`,
    );
    await expect(plot(page).first()).toBeVisible();
    const scroller = page.locator(".datasetPreviewPlotArea");
    const settled = {
      overflows: true,
      labelled: true,
      visible: true,
      offGrid: 0,
    };

    await expect
      .poll(async () => {
        const { ticks: _ticks, ...state } = await pinnedAxisState(page, "x");
        return state;
      })
      .toEqual(settled);
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const { ticks: before, ...atBottom } = await pinnedAxisState(page, "x");
    expect(atBottom).toEqual(settled);

    // Zoomed on the panels, the strip follows and still sits on their grid.
    await scroller.evaluate((element) => {
      element.scrollTop = 0;
    });
    // hover() re-finds the panel: a late render (the profile list) redraws it.
    await page
      .locator(".datasetPreviewPlotArea .nsewdrag")
      .last() // the top panel: the bottom one is scrolled out of view
      .hover();
    await page.mouse.wheel(0, -400);
    await expect
      .poll(async () => {
        const { ticks, ...state } = await pinnedAxisState(page, "x");
        return { ...state, moved: ticks !== before };
      })
      .toEqual({ ...settled, moved: true });
  });

  test("a wide profile's depth axis stays in view while its panels scroll sideways", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await openApp(
      page,
      `dataset=${DATASET}&preview=${encodeURIComponent(RECORD)}&pvars=CHLA,PSAL,SIGT`,
    );
    await expect(plot(page).first()).toBeVisible();
    const settled = {
      overflows: true,
      labelled: true,
      visible: true,
      offGrid: 0,
    };

    await expect
      .poll(async () => {
        const { ticks: _ticks, ...state } = await pinnedAxisState(page, "y");
        return state;
      })
      .toEqual(settled);
    await page.locator(".datasetPreviewPlotArea").evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
    });
    const { ticks: _ticks, ...scrolled } = await pinnedAxisState(page, "y");
    expect(scrolled).toEqual(settled);
  });
});
