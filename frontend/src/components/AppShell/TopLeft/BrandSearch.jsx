import * as React from 'react'
import { InfoSquare } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import CIOOSLogoEN from '../../Images/NationalLogoEnglish.png'
import CIOOSLogoFR from '../../Images/NationalLogoFrench.png'
import FeedbackButton from '../../Controls/FeedbackButton/FeedbackButton.jsx'
import LanguageSelector from '../../Controls/LanguageSelector/LanguageSelector.jsx'
import { useUI } from '../../../state/ui/UIProvider.jsx'
import './styles.css'

// The brand card: logo, the two-line app title lockup, and the minor actions
// (intro / feedback / language) on the top row. The centered top bar passes
// the merged Datasets/Filters control in as children, so it renders as a
// second row welded into this same card.
export default function BrandSearch ({ children }) {
  const { t, i18n } = useTranslation()
  const { setShowIntroModal } = useUI()

  const isFrench = i18n.language === 'fr'

  return (
    <div className='brandSearch'>
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
            <FeedbackButton className='brandMinorItem' size={16} />
            <LanguageSelector className='brandMinorItem brandLanguage' />
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}
