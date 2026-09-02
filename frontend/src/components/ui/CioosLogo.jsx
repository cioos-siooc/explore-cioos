import * as React from 'react'
import { useTranslation } from 'react-i18next'

import Spinner from './Spinner.jsx'
import { useActivity } from '../../state/activity/ActivityProvider.jsx'
import './cioosLogoStyles.css'

// The CIOOS/SIOOC logo, as the animated mark plus live text — no wordmark
// image. Drawing the name rather than loading NationalLogo{English,French}.png
// means it scales, switches language with the rest of the UI, is readable to a
// screen reader, and takes the mark's own animation: the logo *is* the app's
// loading indicator, pulsing while work is in flight and holding still when
// there is none. See cioosLogoStyles.css for how the type is matched to the
// wordmark's outlines.
//
// layout='stacked' is the full lockup — mark above the name, organisation name
// underneath — for the first-paint splash, which has the room for it. It is on
// screen only while the app is loading, so it always animates; the registry it
// would otherwise ask is empty there anyway, the splash being rendered outside
// AppProviders.
// layout='inline' is the compact pairing (mark beside the name, no full name)
// worn by the brand card, where the row is ~100px wide and the full name would
// land at four pixels tall. That one is permanent, so it moves only while there
// is something to move for.
export default function CioosLogo ({ layout = 'inline', className = '' }) {
  const { t } = useTranslation()
  const { announced } = useActivity()
  const stacked = layout === 'stacked'
  const idle = !stacked && !announced

  return (
    <span
      className={`cioosLogo cioosLogo-${layout}${
        idle ? ' cioosLogo-idle' : ''
      } ${className}`.trim()}
    >
      <Spinner size={stacked ? 'lg' : 'md'} role='presentation' />
      <span className='cioosLogoWordmark'>
        <span className='cioosLogoName'>{t('brandName')}</span>
        {stacked && (
          <span className='cioosLogoFullName'>{t('brandFullName')}</span>
        )}
      </span>
    </span>
  )
}
