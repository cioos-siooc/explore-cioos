import * as React from 'react'
import { useTranslation } from 'react-i18next'

import Spinner from '../../ui/Spinner.jsx'
import './styles.css'

// A scrim covering the nearest positioned ancestor, with the animated CIOOS
// mark at its centre.
//
// variant='brand' (default) is the app's first paint — index.jsx's Suspense
// fallback and the initial map load. It names the organisation under the mark,
// as live text rather than the wordmark image the splash used to load: the
// text scales, translates, and is readable to a screen reader.
// variant='inline' is the mark alone, for a panel or section refreshing in
// place, where a wait of a few hundred milliseconds hasn't earned a masthead.
export default function Loading ({ variant = 'brand' }) {
  const { t } = useTranslation()

  return (
    <div className={`loading loading-${variant}`}>
      <Spinner size={variant === 'brand' ? 'lg' : 'md'} />
      {variant === 'brand' && (
        <p className='loadingBrand'>
          <span className='loadingBrandName'>{t('loadingBrandName')}</span>
          <span className='loadingBrandFullName'>
            {t('loadingBrandFullName')}
          </span>
        </p>
      )}
    </div>
  )
}
