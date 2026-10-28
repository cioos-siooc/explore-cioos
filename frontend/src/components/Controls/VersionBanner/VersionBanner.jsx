import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { InfoCircle, X } from 'react-bootstrap-icons'

import './styles.css'

// Newsletter Mailchimp list per language, as on cioos.ca (CIOOS / SIOOC National)
const mailchimpUser = '878a48e5216df1dd94addb795'
const newsletterLists = {
  en: { host: 'cioos.us4.list-manage.com', id: 'a3c7b19b1e' },
  fr: { host: 'siooc.us4.list-manage.com', id: '08bb9ce192' }
}

export default function VersionBanner() {
  const { t, i18n } = useTranslation()
  const list = i18n.language === 'fr' ? newsletterLists.fr : newsletterLists.en
  const newsletterAction = `https://${list.host}/subscribe/post?u=${mailchimpUser}&id=${list.id}`
  // Mailchimp's bot trap: must be submitted empty
  const honeypotName = `b_${mailchimpUser}_${list.id}`
  const [open, setOpen] = useState(true)
  const [submitted, setSubmitted] = useState(false)

  if (!open) return null

  return (
    <div className='versionBanner' role='status'>
      <InfoCircle className='versionBannerIcon' aria-hidden='true' />
      <div className='versionBannerBody'>
        <span>
          {t('versionBannerMessage')} {t('versionBannerSubscribe')}
        </span>
        {submitted ? (
          <span className='versionBannerThanks'>
            {t('versionBannerSubscribed')}
          </span>
        ) : (
          <form
            className='versionBannerForm'
            action={newsletterAction}
            method='post'
            target='_blank'
            // defer so the form is still mounted when the browser submits it
            onSubmit={() => setTimeout(() => setSubmitted(true))}
          >
            <input
              type='email'
              name='EMAIL'
              required
              placeholder='email@email.com'
              aria-label={t('versionBannerEmailLabel')}
            />
            <div className='versionBannerHoneypot' aria-hidden='true'>
              <input type='text' name={honeypotName} tabIndex='-1' defaultValue='' />
            </div>
            <button type='submit'>{t('versionBannerSubscribeButton')}</button>
          </form>
        )}
      </div>
      <button
        type='button'
        className='versionBannerClose'
        aria-label={t('closeButtonText')}
        title={t('closeButtonText')}
        onClick={() => setOpen(false)}
      >
        <X size={22} aria-hidden='true' />
      </button>
    </div>
  )
}
