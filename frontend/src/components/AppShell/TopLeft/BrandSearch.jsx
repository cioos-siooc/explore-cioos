import * as React from 'react'
import {
  Search,
  XCircle,
  InfoSquare,
  ChatDots
} from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import CIOOSLogoEN from '../../Images/NationalLogoEnglish.png'
import CIOOSLogoFR from '../../Images/NationalLogoFrench.png'
import LanguageSelector from '../../Controls/LanguageSelector/LanguageSelector.jsx'
import { useSelection } from '../../../state/selection/SelectionProvider.jsx'
import { useUI, PANELS } from '../../../state/ui/UIProvider.jsx'
import './styles.css'

// Top-left cluster: the brand card (logo + app title on the first row,
// intro / feedback / language actions on the second) with the dataset title
// search floating separately below it. Typing (or focusing) the search
// surfaces the datasets panel so results are visible.
export default function BrandSearch () {
  const { t, i18n } = useTranslation()
  const { datasetTitleSearchText, setDatasetTitleSearchText } = useSelection()
  const { setActivePanel, setShowIntroModal } = useUI()

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
          <h1 className='brandTitle'>{t('brandTitle')}</h1>
        </div>
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
      <div className='brandSearchInputWrapper' role='search'>
        <Search className='brandSearchIcon' size={15} aria-hidden='true' />
        <input
          type='text'
          className='brandSearchInput'
          value={datasetTitleSearchText}
          placeholder={t('brandSearchPlaceholder')}
          aria-label={t('brandSearchPlaceholder')}
          onFocus={() => setActivePanel(PANELS.datasets)}
          onChange={(event) => {
            setDatasetTitleSearchText(event.target.value)
            setActivePanel(PANELS.datasets)
          }}
        />
        {datasetTitleSearchText && (
          <button
            type='button'
            className='brandSearchClear'
            onClick={() => setDatasetTitleSearchText('')}
            aria-label={t('brandSearchClearLabel')}
            title={t('brandSearchClearLabel')}
          >
            <XCircle size={16} aria-hidden='true' />
          </button>
        )}
      </div>
    </div>
  )
}
