import * as React from "react";
import { Megaphone } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";

// Sentry's dialog renders in its own shadow DOM, so labels are handed to it from
// i18n at open time; CIOOS tokens still resolve because custom properties inherit.
export default function FeedbackButton({ className, size = 16, label }) {
  const { t } = useTranslation();

  async function openFeedbackDialog() {
    const { getFeedback } = await import("../../../sentryFeedback.js");
    const feedback = getFeedback();
    // Sentry never initialised (ad-blocker, or SDK load failed).
    if (!feedback) return;

    const form = await feedback.createForm({
      formTitle: t("feedbackFormTitle"),
      messageLabel: t("feedbackMessageLabel"),
      messagePlaceholder: t("feedbackMessagePlaceholder"),
      nameLabel: t("feedbackNameLabel"),
      namePlaceholder: t("feedbackNamePlaceholder"),
      emailLabel: t("feedbackEmailLabel"),
      emailPlaceholder: t("feedbackEmailPlaceholder"),
      submitButtonLabel: t("feedbackSubmitButtonLabel"),
      cancelButtonLabel: t("feedbackCancelButtonLabel"),
      confirmButtonLabel: t("feedbackConfirmButtonLabel"),
      isRequiredLabel: t("feedbackIsRequiredLabel"),
      addScreenshotButtonLabel: t("feedbackAddScreenshotLabel"),
      removeScreenshotButtonLabel: t("feedbackRemoveScreenshotLabel"),
      successMessageText: t("feedbackSuccessMessageText"),
      onFormClose: () => form.removeFromDom(),
      onFormSubmitted: () => form.removeFromDom(),
    });

    form.appendToDom();
    form.open();
  }

  return (
    <button
      type="button"
      className={className}
      onClick={openFeedbackDialog}
      title={t("feedbackButtonTitle")}
      aria-label={label ? undefined : t("feedbackButtonTitle")}
    >
      <Megaphone size={size} aria-hidden="true" />
      {label}
    </button>
  );
}
