import { expect, test } from '../support/test.js'
import { openApp } from '../support/appPage.js'
import { VIEWPORTS } from '../support/constants.js'

// Below (max-width: 700px) the app stops being a map with chrome floating over
// it and becomes a stack of full-screen surfaces. Everything here is about that
// change, so it runs at one width regardless of which project selected it.
test.use({ viewport: VIEWPORTS.mobile })

test.describe('the phone layout', () => {
  test('leads with the map and keeps the list away', async ({ page }) => {
    await openApp(page)
    await expect(page.getByTestId('map-container')).toBeVisible()
    await expect(page.getByTestId('sidebar-datasets')).toHaveAttribute(
      'data-expanded',
      'false'
    )
  })

  test('never scrolls sideways', async ({ page }) => {
    // The failure mode of a floating-chrome layout on a narrow screen: one
    // control that will not fit drags the whole page horizontally.
    await openApp(page)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow, 'the page scrolls horizontally').toBeLessThanOrEqual(0)
  })

  test('opens the datasets list as a full-screen sheet', async ({ page }) => {
    await openApp(page)
    await page.getByTestId('topbar-datasets-button').click()

    const sidebar = page.getByTestId('sidebar')
    await expect(sidebar).toBeVisible()

    const [sheet, viewport] = await Promise.all([
      sidebar.boundingBox(),
      page.viewportSize()
    ])
    // A sheet, not a column beside the map: it should take essentially the
    // whole width.
    expect(sheet.width).toBeGreaterThan(viewport.width * 0.9)
  })

  test('opens filters as a full-screen sheet', async ({ page }) => {
    await openApp(page)
    await page.getByTestId('topbar-filters-button').click()

    const modal = page.getByTestId('filters-modal')
    await expect(modal).toBeVisible()
    const dialog = await modal.locator('.modal-content').boundingBox()
    expect(dialog.width).toBeGreaterThan(page.viewportSize().width * 0.9)
  })

  test('keeps the top controls reachable', async ({ page }) => {
    await openApp(page)
    const bar = await page.getByTestId('top-bar').boundingBox()
    expect(bar.x).toBeGreaterThanOrEqual(0)
    expect(bar.x + bar.width).toBeLessThanOrEqual(page.viewportSize().width + 1)
  })
})
