// Loaded on the first feedback click (see FeedbackButton), so the feedback
// form's code stays out of the entry bundle. Nothing is added when Sentry is
// off (no DSN): getFeedback() then stays undefined and the button does nothing.
import * as Sentry from "@sentry/react";

export function getFeedback() {
  if (!Sentry.getFeedback() && Sentry.isEnabled()) {
    Sentry.addIntegration(
      // autoInject is off: FeedbackButton opens the dialog from the existing
      // chat icons instead of Sentry's own floating button.
      Sentry.feedbackIntegration({
        autoInject: false,
        showBranding: false,
        // Sentry is hosted in the US; the name adds nothing a reply needs, and
        // the email field stays optional (see PrivacyModal).
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
