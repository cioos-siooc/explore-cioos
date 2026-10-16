// `wrapReactRouterRouting` silently returns an *unwrapped* <Routes> if it runs
// before `init`; keeping both here makes importing this module the only
// ordering requirement.
import { useEffect } from "react";
import * as Sentry from "@sentry/react";
import {
  Routes,
  useLocation,
  useNavigationType,
  createRoutesFromChildren,
  matchRoutes,
} from "react-router-dom";

// A build arg baked in by vite's `define`, so it is public in the bundle.
const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.ENVIRONMENT || "development",
  // Already the default; pinned because the privacy notice promises no IP
  // address reaches Sentry (US-hosted).
  sendDefaultPii: false,
  release: process.env.SENTRY_RELEASE,
  integrations: [
    Sentry.reactRouterBrowserTracingIntegration({
      useEffect,
      useLocation,
      useNavigationType,
      createRoutesFromChildren,
      matchRoutes,
    }),
  ],

  // Full tracing adds page-load overhead, so production samples 10%.
  tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE
    ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
    : process.env.NODE_ENV === "production"
      ? 0.1
      : 1.0,
});

export const SentryRoutes = Sentry.wrapReactRouterRouting(Routes);
