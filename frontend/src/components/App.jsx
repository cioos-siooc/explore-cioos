import React from 'react'
import * as Sentry from '@sentry/react'
import { useTranslation } from 'react-i18next'

import AppProviders from '../state/AppProviders.jsx'
import AppShell from './AppShell/AppShell.jsx'
import ErrorBoundary from './ErrorBoundary/ErrorBoundary.jsx'
import EnglishLogo from './Images/CIOOSNationalLogoBlackEnglish.svg'
import FrenchLogo from './Images/CIOOSNationalLogoBlackFrench.svg'

import './styles.css'

if (process.env.NODE_ENV === 'production') {
  Sentry.init({
    dsn: 'https://ccb1d8806b1c42cb83ef83040dc0d7c0@o56764.ingest.sentry.io/5863595',
    integrations: [Sentry.browserTracingIntegration()],

    // Full tracing (1.0) adds instrumentation overhead to page load. Defaults
    // to 1.0 in development and 0.1 in production; override at build time with
    // SENTRY_TRACES_SAMPLE_RATE.
    tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE
      ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
      : process.env.NODE_ENV === 'production'
        ? 0.1
        : 1.0
  })
}

export default function App () {
  return (
    <AppProviders>
      <AppContent />
    </AppProviders>
  )
}

function AppContent () {
  const { t, i18n } = useTranslation()

  return (
    <ErrorBoundary
      errorBoundaryMessage={t('errorBoundaryMessage')}
      logoSource={i18n.language === 'en' ? EnglishLogo : FrenchLogo}
    >
      <AppShell />
    </ErrorBoundary>
  )
}
