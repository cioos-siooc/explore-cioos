import { expect, test } from '../support/test.js'
import { openApp } from '../support/appPage.js'
import { VIEWPORTS } from '../support/constants.js'

// The WebGL canvas is masked out of every shot below. SwiftShader's raster is
// not bit-identical across drivers and MapLibre's tile fade is not fully
// deterministic, so including it would make these permanently red — and what
// actually regresses is the chrome around it: the sidebar, the chips, the
// legend, the modals, and above all the phone layout.
const MASK_MAP = { mask: [] }

async function settle (page) {
  MASK_MAP.mask = [page.locator('.maplibregl-canvas')]
  // Belt and braces alongside the config's animations:'disabled' — that stops
  // CSS animations, this stops anything mid-transition at capture time.
  await page.addStyleTag({
    content: '*,*::before,*::after{animation:none!important;transition:none!important}'
  })
}

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(name, () => {
    test.use({ viewport })

    test('the default view', async ({ page }) => {
      await openApp(page)
      await settle(page)
      await expect(page).toHaveScreenshot(`${name}-default.png`, MASK_MAP)
    })

    test('the datasets list open', async ({ page }) => {
      await openApp(page)
      const panel = page.getByTestId('sidebar-datasets')
      if ((await panel.getAttribute('data-expanded')) !== 'true') {
        await page.getByTestId('topbar-datasets-button').click()
      }
      await expect(page.getByTestId('dataset-card').first()).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${name}-sidebar.png`, MASK_MAP)
    })

    test('the filters modal', async ({ page }) => {
      await openApp(page)
      await page.getByTestId('topbar-filters-button').click()
      await expect(page.getByTestId('filters-panel-list')).toBeVisible()
      await settle(page)
      await expect(page).toHaveScreenshot(`${name}-filters.png`, MASK_MAP)
    })

    test('active filter chips', async ({ page }) => {
      await openApp(page, 'eovs=oxygen&platforms=mooring')
      await expect(page.getByTestId('filter-chip-group')).toHaveCount(2)
      await settle(page)
      await expect(page).toHaveScreenshot(`${name}-chips.png`, MASK_MAP)
    })
  })
}
