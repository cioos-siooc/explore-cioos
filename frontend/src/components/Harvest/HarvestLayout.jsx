import React, { useEffect } from 'react'
import { Link, useSearchParams, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import './styles.css'

export default function HarvestLayout({ breadcrumbs, children }) {
  const { t, i18n } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()

  const lang = searchParams.get('lang') || i18n.language || 'en'
  const otherLang = lang === 'fr' ? 'en' : 'fr'

  useEffect(() => {
    if (lang !== i18n.language) i18n.changeLanguage(lang)
  }, [lang])

  function toggleLanguage() {
    const params = new URLSearchParams(searchParams)
    params.set('lang', otherLang)
    setSearchParams(params)
  }

  return (
    <div className="harvest-root">
      <header className="harvest-header">
        <Link to="/" className="harvest-home-link">{t('harvest.layout.backLink')}</Link>
        <span className="harvest-header-title">{t('harvest.title')}</span>
        <button className="harvest-lang-toggle" onClick={toggleLanguage}>
          {otherLang.toUpperCase()}
        </button>
      </header>
      {breadcrumbs && <nav className="harvest-breadcrumb">{breadcrumbs}</nav>}
      <main className="harvest-main">{children}</main>
    </div>
  )
}
