// This is the entry point for Webpack to grab the js files. This is automatically found by webpack.
// eslint-disable-next-line no-unused-vars
import React from 'react'
import ReactDOM from 'react-dom'
import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import LanguageDetector from 'i18next-browser-languagedetector'
import HttpApi from 'i18next-http-backend';

import App from './components/App.jsx'

// Tutorial for setting up translations using the i18next npm module (and related npm modules)
// https://www.youtube.com/watch?v=w04LXKlusCQ
i18n
  .use(initReactI18next) // passes i18n down to react-i18next
  .use(LanguageDetector)
  .use(HttpApi)
  .init({
    supportedLngs: ['en', 'fr'],
    fallbackLng: "en",
    detection: {
      order: ['cookie', 'htmlTag', 'localStorage', 'path', 'subdomain'],
      caches: ['cookie']
    },
    backend: {
      loadPath: 'src/locales/{{lng}}/translation.json',
    },
    react: { useSuspense: false }
  })

// This is where react reaches into the DOM, finds the <div id="app"> element, and replaces it with the content of ReactD3Viz's render function JSX.
const domContainer = document.querySelector('#app')
ReactDOM.render(<App />, domContainer)