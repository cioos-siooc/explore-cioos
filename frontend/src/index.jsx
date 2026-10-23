// Imported first: Sentry.init must run before the rest of the app is evaluated.
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
import { BrowserRouter, Navigate, Route } from "react-router";
import { clearLegacyCookies } from "./state/usePersistentState.js";

// Self-hosted, not Google Fonts, which would hand visitors' IPs to Google
// (see PrivacyModal).
import "@fontsource/montserrat/300.css";
import "@fontsource/montserrat/400.css";
import "@fontsource/montserrat/500.css";
import "@fontsource/montserrat/600.css";
import "@fontsource/montserrat/700.css";
import "@fontsource/quicksand/300.css";
import "@fontsource/quicksand/600.css";
import "@fontsource/sora/600.css";

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
const HarvestDocs = lazy(() => import("./components/Harvest/HarvestDocs.jsx"));
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

// Screen readers pick their voice from <html lang>.
i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
});

i18n
  .use(initReactI18next)
  .use(LanguageDetector)
  .init({
    resources,
    supportedLngs: ["en", "fr"],
    lng: urlLanguage || undefined,
    fallbackLng: ["en", "fr"],
    interpolation: { escapeValue: false }, // React already escapes; i18next's escaping showed as "&#x2F;"
    detection: {
      order: ["querystring", "localStorage", "htmlTag"],
      lookupQuerystring: "lang",
      caches: ["localStorage"],
    },
    react: { useSuspense: true },
  });
const domContainer = document.querySelector("#app");
createRoot(domContainer).render(
  <Suspense fallback={<Loading />}>
    {/* Synchronous URL updates, as in v6: SelectionProvider and UrlSync rely on
        a URL write batching with the state set beside it. */}
    <BrowserRouter basename={process.env.BASE_URL} useTransitions={false}>
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
          path="/harvest/docs"
          element={<Navigate to="/harvest/docs/workflow" replace />}
        />
        <Route path="/harvest/docs/:doc" element={<HarvestDocs />} />
        <Route
          path="/harvest/downloads/:jobId"
          element={<HarvestDownloadJob />}
        />
      </SentryRoutes>
    </BrowserRouter>
  </Suspense>,
);
