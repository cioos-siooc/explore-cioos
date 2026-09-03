import { test } from '../support/test.js'
import { openApp } from '../support/appPage.js'
import { VIEWPORTS } from '../support/constants.js'
import { RECORDING, expectNoNewViolations, recordBaseline, scan } from '../support/axeBaseline.js'

// One entry per surface worth auditing. Each opens itself from a clean load, so
// a failure names the state it was in.
const STATES = {
  'default view': async (page) => {
    await openApp(page)
  },
  'datasets list open': async (page) => {
    await openApp(page)
    const panel = page.getByTestId('sidebar-datasets')
    if ((await panel.getAttribute('data-expanded')) !== 'true') {
      await page.getByTestId('topbar-datasets-button').click()
    }
    await page.getByTestId('dataset-card').first().waitFor()
  },
  'filters modal': async (page) => {
    await openApp(page)
    await page.getByTestId('topbar-filters-button').click()
    await page.getByTestId('filters-panel-list').waitFor()
  },
  'filter options open': async (page) => {
    await openApp(page)
    await page.getByTestId('topbar-filters-button').click()
    await page.locator('[data-filter-name="oceanVariablesFiltername"]').click()
    await page.getByTestId('filter-option').first().waitFor()
  },
  'active filter chips': async (page) => {
    await openApp(page, 'eovs=oxygen&platforms=mooring')
    await page.getByTestId('filter-chip-group').first().waitFor()
  },
  'intro modal': async (page, context) => {
    // The one surface that needs the cookie cleared, since it is what the rest
    // of the suite sets to get the modal out of the way.
    await context.clearCookies()
    await openApp(page)
  }
}

for (const [state, arrange] of Object.entries(STATES)) {
  test(state, async ({ page, context }) => {
    await arrange(page, context)
    const results = await scan(page)
    if (RECORDING) return recordBaseline(state, results)
    expectNoNewViolations(state, results)
  })
}

test.describe('on a phone', () => {
  test.use({ viewport: VIEWPORTS.mobile })

  test('datasets sheet open', async ({ page }) => {
    await openApp(page)
    await page.getByTestId('topbar-datasets-button').click()
    await page.getByTestId('dataset-card').first().waitFor()
    const results = await scan(page)
    if (RECORDING) return recordBaseline('mobile datasets sheet', results)
    expectNoNewViolations('mobile datasets sheet', results)
  })
})
