import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { InfoCircle, X } from 'react-bootstrap-icons'

import './styles.css'

// CIOOS newsletter, same Mailchimp list as the catalogue footer signup
const newsletterUrl =
  'https://cioos.us4.list-manage.com/subscribe?u=878a48e5216df1dd94addb795&id=a3c7b19b1e'

export default function VersionBanner() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)

  if (!open) return null

  return (
    <div className='versionBanner' role='status'>
      <InfoCircle className='versionBannerIcon' aria-hidden='true' />
      <span>
        {t('versionBannerMessage')}{' '}
        <a
          className='versionBannerLink'
          href={newsletterUrl}
          target='_blank'
          rel='noopener noreferrer'
        >
          {t('versionBannerSubscribe')}
        </a>
      </span>
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
