import * as React from 'react'

import ActivityList from '../../ui/ActivityList.jsx'
import CioosLogo from '../../ui/CioosLogo.jsx'
import Spinner from '../../ui/Spinner.jsx'
import { useActivity } from '../../../state/activity/ActivityProvider.jsx'
import './styles.css'

// A scrim covering the nearest positioned ancestor, with the animated CIOOS
// mark at its centre.
//
// variant='brand' (default) is the app's first paint — index.jsx's Suspense
// fallback and the initial map load. It shows the full stacked logo, which is
// the same drawn mark-and-name lockup the brand card wears (see CioosLogo).
// variant='inline' is the mark alone, for a panel or section refreshing in
// place, where a wait of a few hundred milliseconds hasn't earned a masthead.
export default function Loading ({ variant = 'brand' }) {
  // Empty outside AppProviders — which is where index.jsx's Suspense fallback
  // renders this, before any of the registry's producers exist.
  const { labelKeys } = useActivity()

  return (
    <div className={`loading loading-${variant}`}>
      {variant === 'brand' ? <CioosLogo layout='stacked' /> : <Spinner />}
      {/* What the wait is actually made of. The splash is the longest wait in
          the app, so it names its parts rather than leaving the user to guess. */}
      {variant === 'brand' && (
        <ActivityList labelKeys={labelKeys} className='loadingActivity' />
      )}
    </div>
  )
}
