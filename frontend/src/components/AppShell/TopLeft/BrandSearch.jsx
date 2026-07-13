import * as React from 'react'
import { InfoSquare, ChatDots } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'

import CIOOSLogoEN from '../../Images/NationalLogoEnglish.png'
import CIOOSLogoFR from '../../Images/NationalLogoFrench.png'
import LanguageSelector from '../../Controls/LanguageSelector/LanguageSelector.jsx'
import { useUI } from '../../../state/ui/UIProvider.jsx'
import './styles.css'

// The brand card: logo, the two-line app title lockup, and the minor actions
// (intro / feedback / language) all on one row. Lives in the sidebar header
// while the sidebar is open and floats top-left on its own when it is closed.
export default function BrandSearch ({ floating = false }) {
  const { t, i18n } = useTranslation()
  const { setShowIntroModal } = useUI()

  const isFrench = i18n.language === 'fr'

  return (
    <div className={classNames('brandSearch', { floating })}>
      <div className='brandCard'>
        <div className='brandCardTop'>
          <a
            className='brandSearchLogo'
            href={
              isFrench ? 'https://www.siooc.ca/fr/accueil/' : 'https://www.cioos.ca'
            }
            target='_blank'
            rel='noreferrer'
            title={isFrench ? 'Visitez SIOOC' : 'Visit CIOOS National'}
          >
            <img
              src={isFrench ? CIOOSLogoFR : CIOOSLogoEN}
              alt={isFrench ? 'SIOOC' : 'CIOOS'}
            />
          </a>
          {/* Two-line wordmark; the em word gets the large treatment. */}
          <h1 className='brandTitle' lang={isFrench ? 'fr' : 'en'}>
            {isFrench ? (
              <>
                <em>EXPLORATEUR</em>
                <span>DE DONNÉES</span>
              </>
            ) : (
              <>
                <span>DATA</span>
                <em>EXPLORER</em>
              </>
            )}
          </h1>
          <div className='brandMinorItems'>
            <button
              type='button'
              className='brandMinorItem'
              onClick={() => setShowIntroModal(true)}
              title={t('dockIntroButtonTitle')}
              aria-label={t('dockIntroButtonTitle')}
            >
              <InfoSquare size={16} aria-hidden='true' />
            </button>
            <a
              className='brandMinorItem'
              href={
                isFrench
                  ? 'https://docs.google.com/forms/d/e/1FAIpQLScOHpRSyXeGIwkOCLR9_VLhxs6siSiEuTqEGHG1PVNN0BumsQ/viewform?usp=dialog'
                  : 'https://docs.google.com/forms/d/e/1FAIpQLScrpW_V0whLXAIy7Vk4Wzd2UAZf-hUxPl455jhUlUoUzQGqvg/viewform?usp=dialog'
              }
              target='_blank'
              rel='noreferrer'
              title={t('feedbackButtonTitle')}
              aria-label={t('feedbackButtonTitle')}
            >
              <ChatDots size={16} aria-hidden='true' />
            </a>
            <LanguageSelector className='brandMinorItem brandLanguage' />
          </div>
        </div>
      </div>
    </div>
  )
}
