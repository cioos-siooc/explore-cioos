import React from 'react'
import { InfoSquare, ChatDots } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import LanguageSelector from '../LanguageSelector/LanguageSelector.jsx'
import './styles.css'

export default function SelectionPanelHeader({
  logoSource,
  onInfoClick,
  onFeedbackClick
}) {
  const { i18n } = useTranslation()

  return (
    <header className='selectionPanelHeader' role='banner'>
      <button
        className='headerLogo'
        onClick={() =>
          i18n.language === 'en'
            ? window.open('https://www.cioos.ca')
            : window.open('https://www.siooc.ca/fr/accueil/')
        }
        title={i18n.language === 'en' ? 'Visit CIOOS National' : 'Visitez SIOOC'}
        aria-label={i18n.language === 'en' ? 'Visit CIOOS National' : 'Visitez SIOOC'}
      >
        <img src={logoSource} alt={i18n.language === 'en' ? 'CIOOS' : 'SIOOC'} />
      </button>

      <div className='headerTitle'>
        <h1>Explore CIOOS</h1>
      </div>

      <nav className='headerActions' aria-label='Header actions'>
        <button
          className='headerActionButton'
          onClick={onInfoClick}
          title='Re-open introduction'
          aria-label='Re-open introduction'
        >
          <InfoSquare size={20} aria-hidden='true' />
        </button>

        <a
          className='headerActionButton headerFeedback'
          title='Send feedback'
          href={
            i18n.language === 'en'
              ? 'https://docs.google.com/forms/d/e/1FAIpQLScrpW_V0whLXAIy7Vk4Wzd2UAZf-hUxPl455jhUlUoUzQGqvg/viewform?usp=dialog'
              : 'https://docs.google.com/forms/d/e/1FAIpQLScOHpRSyXeGIwkOCLR9_VLhxs6siSiEuTqEGHG1PVNN0BumsQ/viewform?usp=dialog'
          }
          target='_blank'
          rel='noreferrer'
          aria-label='Send feedback'
        >
          <ChatDots size={20} aria-hidden='true' />
        </a>

        <LanguageSelector className='headerLanguageSelector' />
      </nav>
    </header>
  )
}
