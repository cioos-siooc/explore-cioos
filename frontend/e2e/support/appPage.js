import { expect } from "@playwright/test";

import { DEFAULT_VIEW } from "./constants.js";

export async function openApp(page, search = "") {
  const url = search
    ? `/${DEFAULT_VIEW}&${search.replace(/^[?&]/, "")}`
    : `/${DEFAULT_VIEW}`;
  await page.goto(url);
  await waitForMapReady(page);
}

// Not the splash: that's a CSS transition, which screenshots disable.
export async function waitForMapReady(page) {
  await expect(
    page.locator('[data-testid="map-container"][data-map-ready]'),
  ).toBeAttached({
    timeout: 45_000,
  });
  await expect(page.getByTestId("app-splash")).toHaveCount(0);
}

// Without WebGL the suite would pass while rendering nothing.
export async function webglRenderer(page) {
  return page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null;
  });
}
