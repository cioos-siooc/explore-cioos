import * as React from 'react'
import { ChatDots } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import * as Sentry from '@sentry/react'

// Opens Sentry's User Feedback dialog. The dialog renders inside its own shadow
// DOM, so every label has to be handed to it from i18n at open time — it can't
// pick up translations from our markup. CIOOS tokens still resolve inside the
// shadow root because custom properties inherit through it.
export default function FeedbackButton ({ className, size = 16 }) {
  const { t } = useTranslation()

  async function openFeedbackDialog () {
    const feedback = Sentry.getFeedback()
    // Sentry never initialised (blocked by an ad-blocker, or SDK load failed).
    if (!feedback) return

    const form = await feedback.createForm({
      formTitle: t('feedbackFormTitle'),
      messageLabel: t('feedbackMessageLabel'),
      messagePlaceholder: t('feedbackMessagePlaceholder'),
      nameLabel: t('feedbackNameLabel'),
      namePlaceholder: t('feedbackNamePlaceholder'),
      emailLabel: t('feedbackEmailLabel'),
      emailPlaceholder: t('feedbackEmailPlaceholder'),
      submitButtonLabel: t('feedbackSubmitButtonLabel'),
      cancelButtonLabel: t('feedbackCancelButtonLabel'),
      confirmButtonLabel: t('feedbackConfirmButtonLabel'),
      isRequiredLabel: t('feedbackIsRequiredLabel'),
      addScreenshotButtonLabel: t('feedbackAddScreenshotLabel'),
      removeScreenshotButtonLabel: t('feedbackRemoveScreenshotLabel'),
      successMessageText: t('feedbackSuccessMessageText'),
      onFormClose: () => form.removeFromDom(),
      onFormSubmitted: () => form.removeFromDom()
    })

    form.appendToDom()
    form.open()
  }

  return (
    <button
      type='button'
      className={className}
      onClick={openFeedbackDialog}
      title={t('feedbackButtonTitle')}
      aria-label={t('feedbackButtonTitle')}
    >
      <ChatDots size={size} aria-hidden='true' />
    </button>
  )
}
