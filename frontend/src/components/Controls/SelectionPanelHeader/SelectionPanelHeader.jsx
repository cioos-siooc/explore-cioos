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
    <div className='selectionPanelHeader'>
      <img
        className='headerLogo'
        src={logoSource}
        onClick={() =>
          i18n.language === 'en'
            ? window.open('https://www.cioos.ca')
            : window.open('https://www.siooc.ca/fr/accueil/')
        }
        title='Visit CIOOS website'
        alt='CIOOS Logo'
      />

      <div className='headerTitle'>
        <h2>Explore CIOOS</h2>
      </div>

      <div className='headerActions'>
        <button
          className='headerActionButton'
          onClick={onInfoClick}
          title='Re-open introduction'
          aria-label='Introduction'
        >
          <InfoSquare size={20} />
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
          aria-label='Feedback'
        >
          <ChatDots size={20} />
        </a>

        <LanguageSelector className='headerLanguageSelector' />
      </div>
    </div>
  )
}
