import { useTranslation } from 'react-i18next'
import { InfoSquare, ChatDots, Filter, FileEarmarkSpreadsheet, Download, List } from 'react-bootstrap-icons'
import CIOOSLogoEN from '../../Images/CIOOSNationalLogoBlackEnglish.svg'
import CIOOSLogoFR from '../../Images/CIOOSNationalLogoBlackFrench.svg'
import LanguageSelector from '../LanguageSelector/LanguageSelector.jsx'
import Logo from '../../logo.js'
import './styles.css'
    
    
export  function SmallHeader({setShowIntroModal, setSelectionPanelOpen}) {
  const { t, i18n } = useTranslation()

  return(
    <div className='pointDetailsHeader'>
        <img
          className='pointDetailsHeaderLogo CIOOS'
          src={i18n.language === 'en' ? CIOOSLogoEN : CIOOSLogoFR}
          onClick={() =>
            i18n.language === 'en'
              ? window.open('https://www.cioos.ca')
              : window.open('https://www.siooc.ca/fr/accueil/')
          }
          title={t('PointDetailsCIOOSLogoTitleText')}
        />
        <Logo lang={i18n.language} />
        <button
          className='pointDetailsHeaderIntroButton'
          onClick={() => setShowIntroModal(true)}
          title={t('introReopenTitle')} // 'Re-open introduction'
        >
          <InfoSquare color='#007bff' size={'25px'}  />
        </button>
        <a
          className='feedbackButton'
          title={t('feedbackButtonTitle')}
          href='https://docs.google.com/forms/d/1OAmp6_LDrCyb4KQZ3nANCljXw5YVLD4uzMsWyuh47KI/edit'
          target='_blank'
          rel='noreferrer'
        >
          <ChatDots size='28px' color='#007bff' />
        </a>
        <LanguageSelector className='noPosition' />

        <button
        onClick={() => setSelectionPanelOpen(true)}
        title="Open selection panel"  //  Open the selection panel
        >
          <List color='#007bff' className='w-[30px] h-[25px] mr-[15px]' />

        </button>

        
      </div>
  )
} 
    
    
    