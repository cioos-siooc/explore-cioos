import { expect, test } from '../support/test.js'
import { openApp, webglRenderer } from '../support/appPage.js'

test.describe('the app boots', () => {
  test('paints the map and clears the splash', async ({ page }) => {
    await openApp(page)
    await expect(page.getByTestId('map-container')).toBeVisible()
    await expect(page.getByTestId('top-bar')).toBeVisible()
  })

  test('has a real WebGL context', async ({ page }) => {
    // Without this the suite could go green while rendering nothing: MapLibre
    // would fail to build, the map would never paint, and every screenshot
    // would be blank. Chromium stopped falling back to SwiftShader on its own
    // in 130 — see CHROMIUM_ARGS.
    await openApp(page)
    expect(await webglRenderer(page), 'no WebGL context — check the swiftshader flags')
      .toBeTruthy()
  })

  test('serves every request from a fixture', async ({ page, mockApi }) => {
    // mockApi is asserted empty on teardown; this states the intent explicitly
    // so a failure here reads as "something reached the network", not as an
    // unrelated assertion.
    await openApp(page)
    expect(mockApi).toEqual([])
  })

  test('reproduces the view named in the address', async ({ page }) => {
    await openApp(page, 'eovs=oxygen')
    await expect(page.getByTestId('active-filter-chips')).toBeVisible()
    await expect(
      page.locator('[data-filter-key="eovs"] [data-testid="filter-chip-item"]')
    ).toContainText('Oxygen')
  })
})
