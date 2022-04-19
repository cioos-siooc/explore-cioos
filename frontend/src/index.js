// This is the entry point for Webpack to grab the js files. This is automatically found by webpack.
// eslint-disable-next-line no-unused-vars
import React from 'react'
import ReactDOM from 'react-dom'
import { Suspense } from 'react'
import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import LanguageDetector from 'i18next-browser-languagedetector'
import HttpApi from 'i18next-http-backend'
import Loading from './components/Controls/Loading/Loading.jsx'
import translationEN from './locales/en/translation.json'
import translationFR from './locales/fr/translation.json'
import App from './components/App.jsx'

const resources = {
  en: {
    translation: translationEN,
  },
  fr: {
    translation: translationFR,
  },
};

const urlLanguage = new URL(window.location.href).searchParams.get('lang')

// Tutorial for setting up translations using the i18next npm module (and related npm modules)
// https://www.youtube.com/watch?v=w04LXKlusCQ
i18n
  .use(initReactI18next) // passes i18n down to react-i18next
  .use(LanguageDetector)
  .use(HttpApi)
  .init({
    resources,
    supportedLngs: ['en', 'fr'],
    lng: urlLanguage,
    fallbackLng: "en",
    react: { useSuspense: true }
  })  

// This is where react reaches into the DOM, finds the <div id="app"> element, and replaces it with the content of ReactD3Viz's render function JSX.
const domContainer = document.querySelector('#app')
ReactDOM.render(
  <Suspense fallback={<Loading />}>
    <App />
  </Suspense>
  , domContainer)