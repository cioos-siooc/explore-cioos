import { expect, test } from "../support/test.js";
import { openApp } from "../support/appPage.js";

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

    await expect(page.getByText(RECORD)).toBeVisible();
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

    await expect(modeToggle).toHaveText("Markers");
    await modeToggle.click();
    await mode("Markers + Line").click();

    await expect(modeToggle).toHaveText("Markers + Line");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("pmode"))
      .toBe("markers+lines");

    // Back to the default and the param goes, rather than being pinned at it.
    await modeToggle.click();
    await mode("Markers").click();

    await expect(modeToggle).toHaveText("Markers");
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
