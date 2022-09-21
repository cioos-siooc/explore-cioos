import * as React from 'react'
import i18next from 'i18next'
import { useTranslation } from 'react-i18next'
import { updateMapToolTitleLanguage } from '../../../utilities'
import './styles.css'

export default function LanguageSelector({ className }) {
  const { t, i18n } = useTranslation()
  const otherLanguage = i18n.languages.filter((lang) => lang !== i18n.language)

  return (
    <div
      className={className + ' languageSelector'}
      onClick={() => {
        i18next.changeLanguage(otherLanguage)
        // change URL lang parameter
        const url = new URL(window.location.href)
        url.searchParams.set('lang', otherLanguage)
        history.replaceState(null, '', url)
        updateMapToolTitleLanguage(t)
      }}
      title={t('languageSelectorTitle')}
    >
      {`${otherLanguage}`.toUpperCase()}
    </div>
  )
}
