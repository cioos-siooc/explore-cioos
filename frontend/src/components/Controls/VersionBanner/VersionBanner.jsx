import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { InfoCircle, X } from 'react-bootstrap-icons'

import './styles.css'

export default function VersionBanner() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)

  if (!open) return null

  return (
    <div className='versionBanner' role='status'>
      <InfoCircle className='versionBannerIcon' aria-hidden='true' />
      <span>{t('versionBannerMessage')}</span>
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
