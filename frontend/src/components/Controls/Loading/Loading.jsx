import * as React from 'react'
import { useTranslation } from 'react-i18next'

import ActivityList from '../../ui/ActivityList.jsx'
import Spinner from '../../ui/Spinner.jsx'
import { useActivity } from '../../../state/activity/ActivityProvider.jsx'
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
  // Empty outside AppProviders — which is where index.jsx's Suspense fallback
  // renders this, before any of the registry's producers exist.
  const { labelKeys } = useActivity()

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
      {/* What the wait is actually made of. The splash is the longest wait in
          the app, so it names its parts rather than leaving the user to guess. */}
      {variant === 'brand' && (
        <ActivityList labelKeys={labelKeys} className='loadingActivity' />
      )}
    </div>
  )
}
