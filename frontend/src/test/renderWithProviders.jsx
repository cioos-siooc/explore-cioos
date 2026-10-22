import * as React from "react";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter } from "react-router";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";

import AppProviders from "../state/AppProviders.jsx";
import translationEN from "../locales/en/translation.json";

// The real English bundle, not a stub, so a missing key shows up as the raw
// key in a failing assertion.
function createI18n() {
  const instance = createInstance();
  instance.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    supportedLngs: ["en", "fr"],
    resources: { en: { translation: translationEN } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  return instance;
}

/**
 * @param options.url        seeds state exactly as that share link would.
 * @param options.providers  'none' (router + i18n) or 'app' (AppProviders,
 *                           whose nesting order is load-bearing: never
 *                           re-compose it).
 */
export function renderWithProviders(
  ui,
  { url = "/", providers = "none", ...options } = {},
) {
  // Before render and via history, not MemoryRouter: providers seed from
  // window.location in useState initialisers, which initialEntries never
  // touches, so seeded-state assertions would pass while testing nothing.
  window.history.replaceState({}, "", url);
  const i18n = createI18n();

  function Wrapper({ children }) {
    const content =
      providers === "app" ? <AppProviders>{children}</AppProviders> : children;
    return (
      <I18nextProvider i18n={i18n}>
        <BrowserRouter useTransitions={false}>{content}</BrowserRouter>
      </I18nextProvider>
    );
  }

  return {
    user: userEvent.setup(),
    i18n,
    ...render(ui, { wrapper: Wrapper, ...options }),
  };
}

export { renderWithProviders as default };
export * from "@testing-library/react";
