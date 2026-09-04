import { expect, test } from '../support/test.js'
import { openApp } from '../support/appPage.js'
import { VIEWPORTS } from '../support/constants.js'

// The datasets list is open by default only above (min-width: 1400px), so what
// this spec expects depends on which project is running it.
function startsOpen (viewportWidth) {
  return viewportWidth >= 1400
}

test.describe('the datasets sidebar', () => {
  test('opens by default only where there is map to spare', async ({ page }, testInfo) => {
    await openApp(page)
    const expanded = startsOpen(testInfo.project.use.viewport.width)
    await expect(page.getByTestId('sidebar-datasets')).toHaveAttribute(
      'data-expanded',
      String(expanded)
    )
  })

  test('opens and closes again', async ({ page }, testInfo) => {
    await openApp(page)
    const panel = page.getByTestId('sidebar-datasets')
    const wasOpen = startsOpen(testInfo.project.use.viewport.width)

    if (wasOpen) {
      await page.getByTestId('topbar-datasets-button').click()
      await expect(panel).toHaveAttribute('data-expanded', 'false')
    }

    await page.getByTestId('topbar-datasets-button').click()
    await expect(panel).toHaveAttribute('data-expanded', 'true')

    // Closing is the list's own control, not the top bar's: once open it is a
    // sheet over the map, and on a phone it covers the top bar entirely — which
    // is why reaching back up there would be the wrong gesture to assert.
    await page.getByTestId('sidebar-toggle').click()
    await expect(panel).toHaveAttribute('data-expanded', 'false')
  })

  test('lists the datasets the fixture holds', async ({ page }) => {
    await openApp(page)
    const panel = page.getByTestId('sidebar-datasets')
    if ((await panel.getAttribute('data-expanded')) !== 'true') {
      await page.getByTestId('topbar-datasets-button').click()
    }
    await expect(page.getByTestId('dataset-card').first()).toBeVisible()
  })

  test('a user override outlives a resize', async ({ page }) => {
    // The rule is undocumented outside a comment in UIProvider and is exactly
    // what a responsive-layout change breaks: once the user has made the call,
    // the screen-size default no longer applies.
    await page.setViewportSize(VIEWPORTS.desktop)
    await openApp(page)
    const panel = page.getByTestId('sidebar-datasets')
    await expect(panel).toHaveAttribute('data-expanded', 'true')

    await page.getByTestId('topbar-datasets-button').click()
    await expect(panel).toHaveAttribute('data-expanded', 'false')

    await page.setViewportSize(VIEWPORTS.tablet)
    await page.setViewportSize(VIEWPORTS.desktop)
    await expect(panel).toHaveAttribute('data-expanded', 'false')
  })
})
