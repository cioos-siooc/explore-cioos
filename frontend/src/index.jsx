// This is the app entry point, loaded as a module script by index.html (Vite).
// eslint-disable-next-line no-unused-vars
import React, { Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import Loading from './components/Controls/Loading/Loading.jsx'
import translationEN from './locales/en/translation.json'
import translationFR from './locales/fr/translation.json'
import App from './components/App.jsx'
import HarvestOverview from './components/Harvest/HarvestOverview.jsx'
import HarvestServer   from './components/Harvest/HarvestServer.jsx'
import HarvestDataset  from './components/Harvest/HarvestDataset.jsx'
import HarvestRun      from './components/Harvest/HarvestRun.jsx'
import HarvestDownloads   from './components/Harvest/HarvestDownloads.jsx'
import HarvestDownloadJob from './components/Harvest/HarvestDownloadJob.jsx'
import { BrowserRouter, Routes, Route } from 'react-router-dom'

// CIOOS National design tokens + base typography. Imported first so the
// var(--cioos-*) tokens and base font rules are available to every component.
import './components/theme.css'

const resources = {
  en: {
    translation: translationEN
  },
  fr: {
    translation: translationFR
  }
}

const urlLanguage = new URL(window.location.href).searchParams.get('lang')

// Tutorial for setting up translations using the i18next npm module (and related npm modules)
// https://www.youtube.com/watch?v=w04LXKlusCQ
i18n
  .use(initReactI18next) // passes i18n down to react-i18next
  .use(LanguageDetector)
  .init({
    resources,
    showSupportNotice: false,
    supportedLngs: ['en', 'fr'],
    // A ?lang= in the link always wins; without one the detector falls back to
    // the last language the user chose here (localStorage), so the choice
    // survives a reload. Both caches are written on every changeLanguage.
    lng: urlLanguage || undefined,
    fallbackLng: ['en', 'fr'],
    detection: {
      order: ['querystring', 'localStorage', 'cookie', 'htmlTag'],
      lookupQuerystring: 'lang',
      caches: ['localStorage', 'cookie']
    },
    react: { useSuspense: true }
  })
// This is where react reaches into the DOM, finds the <div id="app"> element, and renders the app into it.
const domContainer = document.querySelector('#app')
createRoot(domContainer).render(
  <Suspense fallback={<Loading />}>
    <BrowserRouter basename={process.env.BASE_URL}>
      <Routes>
        <Route path='/' element={<App />} />
        <Route path='/harvest'                           element={<HarvestOverview />} />
        <Route path='/harvest/server/:slug'              element={<HarvestServer />} />
        <Route path='/harvest/dataset/:slug/:datasetId'  element={<HarvestDataset />} />
        <Route path='/harvest/run/:runId'                element={<HarvestRun />} />
        <Route path='/harvest/downloads'                 element={<HarvestDownloads />} />
        <Route path='/harvest/downloads/:jobId'          element={<HarvestDownloadJob />} />
      </Routes>
    </BrowserRouter>
  </Suspense>
)
