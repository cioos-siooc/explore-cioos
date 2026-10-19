// Lazy-loaded on the first feedback click to keep it out of the entry bundle.
import * as Sentry from "@sentry/react";

export function getFeedback() {
  if (!Sentry.getFeedback() && Sentry.isEnabled()) {
    Sentry.addIntegration(
      Sentry.feedbackIntegration({
        autoInject: false,
        showBranding: false,
        // Sentry is US-hosted: collect no name (see PrivacyModal).
        showName: false,
        colorScheme: "light",
        themeLight: {
          foreground: "var(--cioos-ink)",
          background: "var(--cioos-white)",
          accentBackground: "var(--cioos-primary)",
          accentForeground: "var(--cioos-on-primary)",
          successColor: "var(--cioos-success)",
          errorColor: "var(--cioos-error)",
          boxShadow: "var(--cioos-shadow-float)",
        },
      }),
    );
  }
  return Sentry.getFeedback();
}
