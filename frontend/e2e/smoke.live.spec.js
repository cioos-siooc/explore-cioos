// Against a real stack, no fixtures:
//
//   LIVE_BASE_URL=http://localhost:8098 npm run test:e2e:live
import { expect, test } from "@playwright/test";

import { waitForMapReady, webglRenderer } from "./support/appPage.js";

test("the deployed app loads without errors", async ({ page }) => {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("requestfailed", (request) =>
    errors.push(`${request.failure()?.errorText} ${request.url()}`),
  );

  await page.goto("/");
  await waitForMapReady(page);

  expect(await webglRenderer(page), "no WebGL context").toBeTruthy();
  await expect(page.getByTestId("top-bar")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the real api answers the catalogue queries", async ({
  page,
  baseURL,
}) => {
  // An empty catalogue is still a broken deployment.
  await page.goto("/");
  await waitForMapReady(page);

  const datasets = await page.request.get(`${baseURL}/api/datasets`);
  expect(datasets.ok(), "GET /api/datasets").toBe(true);
  expect((await datasets.json()).length).toBeGreaterThan(0);
});
