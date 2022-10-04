import * as React from 'react'
import { useTranslation } from 'react-i18next'
import './styles.css'
import { useNavigate, useParams, Link, useSearchParams } from 'react-router-dom'

export default function LanguageSelector({ className }) {
  const { t, i18n } = useTranslation()
  const { lang } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const otherLanguage = i18n.languages.filter((l) => l !== lang).pop()

  return (
    <div
      className={className + ' languageSelector'}
      title={t('languageSelectorTitle')}
      onClick={() => {
        const params = searchParams
        params.set('lang', otherLanguage)
        navigate('?' + params.toString())
      }}
    >
      {`${otherLanguage}`.toUpperCase()}
    </div>
  )
}
