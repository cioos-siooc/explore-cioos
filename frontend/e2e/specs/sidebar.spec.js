import { expect, test } from "../support/test.js";
import { openApp } from "../support/appPage.js";
import { VIEWPORTS } from "../support/constants.js";

test.describe("the datasets sidebar", () => {
  test("starts closed on every screen size", async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId("sidebar-datasets")).toHaveAttribute(
      "data-expanded",
      "false",
    );
  });

  test("opens and closes again", async ({ page }) => {
    await openApp(page);
    const panel = page.getByTestId("sidebar-datasets");

    await page.getByTestId("topbar-datasets-button").click();
    await expect(panel).toHaveAttribute("data-expanded", "true");

    // On a phone the open list covers the top bar.
    await page.getByTestId("sidebar-collapse").click();
    await expect(panel).toHaveAttribute("data-expanded", "false");
  });

  test("lists the datasets the fixture holds", async ({ page }) => {
    await openApp(page);
    const panel = page.getByTestId("sidebar-datasets");
    if ((await panel.getAttribute("data-expanded")) !== "true") {
      await page.getByTestId("topbar-datasets-button").click();
    }
    await expect(page.getByTestId("dataset-card").first()).toBeVisible();
  });

  test("keeps a dataset selected across a results refresh", async ({
    page,
  }) => {
    // A filter change must not empty the download basket; nothing on screen
    // says so.
    await openApp(page);
    const panel = page.getByTestId("sidebar-datasets");
    if ((await panel.getAttribute("data-expanded")) !== "true") {
      await page.getByTestId("topbar-datasets-button").click();
    }

    const cards = panel.getByTestId("dataset-card");
    const datasetPk = await cards.first().getAttribute("data-dataset-pk");
    const card = panel.locator(`[data-dataset-pk="${datasetPk}"]`);
    await card.getByRole("checkbox", { name: "Add to selection" }).click();
    await expect(card).toHaveAttribute("data-selected", "true");

    await page.getByTestId("sidebar-collapse").click();
    await page.getByTestId("topbar-filters-button").click();
    await page.locator('[data-filter-name="oceanVariablesFiltername"]').click();
    const filteredResults = page.waitForResponse((response) =>
      response.url().includes("/pointQuery?"),
    );
    await page.getByTestId("filter-option").first().click();
    await filteredResults;
    await page
      .getByTestId("filters-modal")
      .getByRole("button", { name: "Close" })
      .click();
    await page.getByTestId("topbar-datasets-button").click();

    // Still selected if the filter kept it; either way the second click on the
    // same control is what un-selects it.
    if (await card.isVisible()) {
      await expect(card).toHaveAttribute("data-selected", "true");
      await card.getByRole("checkbox", { name: "Add to selection" }).click();
      await expect(card).toHaveAttribute("data-selected", "false");
    }
  });

  test("a user override outlives a resize", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.desktop);
    await openApp(page);
    const panel = page.getByTestId("sidebar-datasets");

    await page.getByTestId("topbar-datasets-button").click();
    await expect(panel).toHaveAttribute("data-expanded", "true");

    await page.setViewportSize(VIEWPORTS.tablet);
    await page.setViewportSize(VIEWPORTS.desktop);
    await expect(panel).toHaveAttribute("data-expanded", "true");
  });

  test("widens a dataset page over the map, and Escape returns it to the sidebar", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile",
      "a phone's dataset page is already full-screen",
    );
    await openApp(page, "dataset=HakaiBIOOSBuoy1hour");
    const panel = page.getByTestId("sidebar-datasets");
    if ((await panel.getAttribute("data-expanded")) !== "true") {
      await page.getByTestId("topbar-datasets-button").click();
    }
    const narrowWidth = (await panel.boundingBox()).width;

    await page.getByTestId("sidebar-wide-toggle").click();
    await expect(page).toHaveURL(/[?&]wide=1/);
    await expect(page.getByTestId("sidebar-scrim")).toBeVisible();
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Metadata" })).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Data", exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => (await panel.boundingBox()).width)
      .toBeGreaterThan(narrowWidth * 1.5);

    await page.keyboard.press("Escape");
    await expect(page).not.toHaveURL(/[?&]wide=/);
    await expect(page.getByRole("tablist")).toBeVisible();
    await expect(page.getByTestId("sidebar-scrim")).toHaveCount(0);
  });

  test("widens the datasets list into a grid of cards", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile",
      "a phone's list is already full-screen",
    );
    await openApp(page);
    const panel = page.getByTestId("sidebar-datasets");
    if ((await panel.getAttribute("data-expanded")) !== "true") {
      await page.getByTestId("topbar-datasets-button").click();
    }
    await page.getByTestId("sidebar-wide-toggle").click();
    await expect(page).toHaveURL(/[?&]wide=1/);

    // Two cards side by side: the second starts on the first one's row.
    const cards = page.getByTestId("dataset-card");
    await expect(cards.nth(1)).toBeVisible();
    const [first, second] = await Promise.all([
      cards.nth(0).boundingBox(),
      cards.nth(1).boundingBox(),
    ]);
    expect(second.y).toBeCloseTo(first.y, 0);
    expect(second.x).toBeGreaterThan(first.x);

    await page.getByTestId("sidebar-scrim").click({ position: { x: 5, y: 5 } });
    await expect(page).not.toHaveURL(/[?&]wide=/);
  });
});
