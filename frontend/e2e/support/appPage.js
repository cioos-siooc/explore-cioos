import { expect } from '@playwright/test'

import { DEFAULT_VIEW } from './constants.js'

// Open the app at a known state and wait until the map has actually painted.
//
// Deep-linking rather than clicking is deliberate: useUrlSync is the sole writer
// of the URL and every provider seeds itself back out of it, so an address is a
// complete description of what the user is looking at. That keeps setup out of
// the specs and keeps them working when the chrome moves.
export async function openApp (page, search = '') {
  const url = search ? `/${DEFAULT_VIEW}&${search.replace(/^[?&]/, '')}` : `/${DEFAULT_VIEW}`
  await page.goto(url)
  await waitForMapReady(page)
}

// The map's own first-paint condition, surfaced on the container by Map.jsx.
// Waiting on the splash instead would mean asserting on a CSS opacity
// transition — the very thing screenshots disable — and on a class name that
// exists for styling.
export async function waitForMapReady (page) {
  await expect(page.locator('[data-testid="map-container"][data-map-ready]')).toBeAttached({
    timeout: 45_000
  })
  await expect(page.getByTestId('app-splash')).toHaveCount(0)
}

// Guards against a suite that passes while rendering nothing: if WebGL is not
// actually available, MapLibre never builds and every map assertion below is
// meaningless.
export async function webglRenderer (page) {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null
  })
}
