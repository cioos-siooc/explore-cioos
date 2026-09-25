import { expect, test } from "../support/test.js";
import { openApp } from "../support/appPage.js";

test.describe("time coverage", () => {
  test("opens from the top bar and renders the histogram", async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId("coverage-modal")).toHaveCount(0);

    await page.getByTestId("topbar-coverage-button").click();

    await expect(page.getByTestId("coverage-modal")).toBeVisible();
    await expect(
      page.locator(".coverageHistogramPlot .main-svg").first(),
    ).toBeVisible();
  });

  test("switching what the bars count refetches the figure", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByTestId("topbar-coverage-button").click();
    await expect(
      page.locator(".coverageHistogramPlot .main-svg").first(),
    ).toBeVisible();

    const countToggle = page.getByTestId("coverage-count-dropdown-toggle");
    await expect(countToggle).toHaveText("Days of data");
    // Days is the one metric that adds its own explanatory note underneath.
    await expect(page.getByText(/added together/)).toBeVisible();

    await countToggle.click();
    await page
      .getByTestId("coverage-count-option")
      .getByText("Datasets", { exact: true })
      .click();

    await expect(countToggle).toHaveText("Datasets");
    await expect(page.getByText(/added together/)).toHaveCount(0);
  });

  test("switching the grouping shows the organization caveat", async ({
    page,
  }) => {
    await openApp(page);
    await page.getByTestId("topbar-coverage-button").click();
    await expect(
      page.locator(".coverageHistogramPlot .main-svg").first(),
    ).toBeVisible();

    const groupToggle = page.getByTestId("coverage-group-dropdown-toggle");
    await groupToggle.click();
    await page
      .getByTestId("coverage-group-option")
      .getByText("Organization", { exact: true })
      .click();

    await expect(groupToggle).toHaveText("Organization");
    await expect(page.getByText(/counted under each one/)).toBeVisible();
  });

  test("closing returns to the map", async ({ page }) => {
    await openApp(page);
    await page.getByTestId("topbar-coverage-button").click();
    await expect(page.getByTestId("coverage-modal")).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.getByTestId("coverage-modal")).toHaveCount(0);
  });
});
