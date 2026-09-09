// Sentry bootstrap. Owns `Sentry.init` and the router instrumentation that
// depends on it: `wrapReactRouterRouting` reads the react-router hooks that
// `reactRouterBrowserTracingIntegration` captures during `init`, and silently
// returns an *unwrapped* <Routes> if it runs first. Keeping both here means
// importing this module is the only ordering requirement.
import { useEffect } from "react";
import * as Sentry from "@sentry/react";
import {
  Routes,
  useLocation,
  useNavigationType,
  createRoutesFromChildren,
  matchRoutes,
} from "react-router-dom";

// The same SENTRY_DSN web-api reads at runtime, baked in at build time by
// vite's `define` (see vite.config.mjs) — the SPA has no runtime env, so for
// the browser it is a build arg, not a container variable. It therefore ships
// in the bundle and is readable by anyone loading the site.
const dsn = process.env.SENTRY_DSN;

// Gated on the DSN, the same way web-api's instrument.js is: no DSN configured
// means no client transport, so nothing is sent, no integration is set up, and
// both the feedback dialog and route tracing stay inert. FeedbackButton and
// SentryRoutes below each handle that case.
Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.ENVIRONMENT || "development",
  release: process.env.SENTRY_RELEASE,
  integrations: [
    // Router-aware tracing: names pageload/navigation transactions after the
    // matched route pattern (`/harvest/dataset/:slug/:datasetId`) instead of
    // the raw URL, so per-record traffic groups into one transaction rather
    // than one per id.
    Sentry.reactRouterBrowserTracingIntegration({
      useEffect,
      useLocation,
      useNavigationType,
      createRoutesFromChildren,
      matchRoutes,
    }),
    // The feedback form replaces the old Google Form survey. autoInject is off:
    // FeedbackButton opens the dialog from the existing chat icons instead of
    // Sentry's own floating button.
    Sentry.feedbackIntegration({
      autoInject: false,
      showBranding: false,
      colorScheme: "light",
      themeLight: {
        foreground: "var(--cioos-ink)",
        background: "var(--cioos-white)",
        accentBackground: "var(--cioos-primary)",
        accentForeground: "var(--cioos-white)",
        successColor: "var(--cioos-success)",
        errorColor: "var(--cioos-error)",
        boxShadow: "var(--cioos-shadow-float)",
      },
    }),
  ],

  // Full tracing (1.0) adds instrumentation overhead to page load. Defaults
  // to 1.0 in development and 0.1 in production; override at build time with
  // SENTRY_TRACES_SAMPLE_RATE.
  tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE
    ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
    : process.env.NODE_ENV === "production"
      ? 0.1
      : 1.0,
});

// Drop-in replacement for react-router's <Routes>. Falls back to the plain
// component when tracing is not set up (no DSN), so rendering never depends on
// Sentry being live.
export const SentryRoutes = Sentry.wrapReactRouterRouting(Routes);
