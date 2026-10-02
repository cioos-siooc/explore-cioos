// This is the app entry point, loaded as a module script by index.html (Vite).

// Imported first: Sentry.init must run before the rest of the app is
// evaluated, and SentryRoutes is only instrumented once it has.
import { SentryRoutes } from "./sentry.js";
import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import Loading from "./components/Controls/Loading/Loading.jsx";
import translationEN from "./locales/en/translation.json";
import translationFR from "./locales/fr/translation.json";
import App from "./components/App.jsx";
import { BrowserRouter, Route } from "react-router-dom";
import { clearLegacyCookies } from "./state/usePersistentState.js";

// Served from this origin rather than Google Fonts, which would hand every
// visitor's IP address to Google (see PrivacyModal). The weights index.html
// used to request.
import "@fontsource/montserrat/300.css";
import "@fontsource/montserrat/400.css";
import "@fontsource/montserrat/500.css";
import "@fontsource/montserrat/600.css";
import "@fontsource/montserrat/700.css";
import "@fontsource/quicksand/300.css";
import "@fontsource/quicksand/600.css";
import "@fontsource/sora/600.css";

// CIOOS National design tokens + base typography. Imported first so the
// var(--cioos-*) tokens and base font rules are available to every component.
import "./components/theme.css";

// The admin views are a separate audience; map visitors never download them.
const HarvestOverview = lazy(
  () => import("./components/Harvest/HarvestOverview.jsx"),
);
const HarvestServer = lazy(
  () => import("./components/Harvest/HarvestServer.jsx"),
);
const HarvestDataset = lazy(
  () => import("./components/Harvest/HarvestDataset.jsx"),
);
const HarvestRun = lazy(() => import("./components/Harvest/HarvestRun.jsx"));
const HarvestDownloads = lazy(
  () => import("./components/Harvest/HarvestDownloads.jsx"),
);
const HarvestDownloadJob = lazy(
  () => import("./components/Harvest/HarvestDownloadJob.jsx"),
);

const resources = {
  en: {
    translation: translationEN,
  },
  fr: {
    translation: translationFR,
  },
};

clearLegacyCookies();

const urlLanguage = new URL(window.location.href).searchParams.get("lang");

// Screen readers pick their voice from <html lang>, so French must not be read
// with English pronunciation.
i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
});

// Tutorial for setting up translations using the i18next npm module (and related npm modules)
// https://www.youtube.com/watch?v=w04LXKlusCQ
i18n
  .use(initReactI18next) // passes i18n down to react-i18next
  .use(LanguageDetector)
  .init({
    resources,
    showSupportNotice: false,
    supportedLngs: ["en", "fr"],
    // A ?lang= in the link always wins; without one the detector falls back to
    // the last language the user chose here (localStorage), so the choice
    // survives a reload.
    lng: urlLanguage || undefined,
    fallbackLng: ["en", "fr"],
    detection: {
      order: ["querystring", "localStorage", "htmlTag"],
      lookupQuerystring: "lang",
      caches: ["localStorage"],
    },
    react: { useSuspense: true },
  });
// This is where react reaches into the DOM, finds the <div id="app"> element, and renders the app into it.
const domContainer = document.querySelector("#app");
createRoot(domContainer).render(
  <Suspense fallback={<Loading />}>
    <BrowserRouter basename={process.env.BASE_URL}>
      <SentryRoutes>
        <Route path="/" element={<App />} />
        <Route path="/harvest" element={<HarvestOverview />} />
        <Route path="/harvest/server/:slug" element={<HarvestServer />} />
        <Route
          path="/harvest/dataset/:slug/:datasetId"
          element={<HarvestDataset />}
        />
        <Route path="/harvest/run/:runId" element={<HarvestRun />} />
        <Route path="/harvest/downloads" element={<HarvestDownloads />} />
        <Route
          path="/harvest/downloads/:jobId"
          element={<HarvestDownloadJob />}
        />
      </SentryRoutes>
    </BrowserRouter>
  </Suspense>,
);
