import * as React from 'react'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'

import AppProviders from '../state/AppProviders.jsx'
import translationEN from '../locales/en/translation.json'

// A fresh i18n instance per render, seeded with the real English bundle rather
// than a stub: assertions then read the product's own copy, and a component
// referencing a key that doesn't exist renders the raw key, which is visible in
// a failing assertion instead of silently passing.
//
// useSuspense is off because there is nothing async to wait for here — the
// bundle is already in memory — and a suspended tree would need an extra
// boundary in every test.
function createI18n () {
  const instance = createInstance()
  instance.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    supportedLngs: ['en', 'fr'],
    resources: { en: { translation: translationEN } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false }
  })
  return instance
}

/**
 * Render a component under the app's real context.
 *
 * @param ui                 element to render
 * @param options.url        address to open at. This is how state is seeded:
 *                           useUrlSync.js is the sole writer of the URL, and
 *                           each provider reads its own slice back out of the
 *                           address the app was opened at (FilterProvider the
 *                           filters, MapStateProvider the camera,
 *                           SelectionProvider the selection/search/grouping).
 *                           So `{ url: '?eovs=oxygen&onlyInView=true' }` sets up
 *                           exactly what that share link would.
 * @param options.providers  'none' (default) renders under router + i18n only,
 *                           for leaf components; 'app' adds AppProviders, whose
 *                           nesting order is load-bearing — reuse it, never
 *                           re-compose it.
 */
export function renderWithProviders (ui, { url = '/', providers = 'none', ...options } = {}) {
  // BEFORE render, and via history rather than the router: every provider seeds
  // itself from `new URL(window.location.href).searchParams` in a useState
  // initialiser (FilterProvider.jsx:239, MapStateProvider.jsx:96/201/231,
  // SelectionProvider.jsx:73, usePersistentState.js:46), which a MemoryRouter's
  // initialEntries never touches — the providers would silently seed to their
  // defaults while useSearchParams reported the seeded values, and every
  // seeded-state assertion would pass while testing nothing.
  //
  // BrowserRouter over jsdom's real History API also means useUrlSync's
  // navigate('?…', { replace: true }) writes a window.location.search a test can
  // read back, which is what makes the seed -> serialize round-trip assertable.
  window.history.replaceState({}, '', url)
  const i18n = createI18n()

  function Wrapper ({ children }) {
    const content =
      providers === 'app' ? <AppProviders>{children}</AppProviders> : children
    return (
      <I18nextProvider i18n={i18n}>
        <BrowserRouter>{content}</BrowserRouter>
      </I18nextProvider>
    )
  }

  return {
    user: userEvent.setup(),
    i18n,
    ...render(ui, { wrapper: Wrapper, ...options })
  }
}

export { renderWithProviders as default }
export * from '@testing-library/react'
