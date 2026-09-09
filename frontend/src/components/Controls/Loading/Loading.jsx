import * as React from 'react'

import ActivityList from '../../ui/ActivityList.jsx'
import CioosLogo from '../../ui/CioosLogo.jsx'
import Spinner from '../../ui/Spinner.jsx'
import { useActivity } from '../../../state/activity/ActivityProvider.jsx'
import './styles.css'

// A cover over the nearest positioned ancestor, with the animated CIOOS mark at
// its centre.
//
// variant='brand' (default) is the app's first paint — index.jsx's Suspense
// fallback and the initial map load. It shows the full stacked logo, which is
// the same drawn mark-and-name lockup the brand card wears (see CioosLogo), and
// it veils the app rather than hiding it: thin enough that the basemap and its
// coastlines read through from the first frame, which is what tells the user
// where they are while the data is still on its way. It used to be opaque, to
// keep a half-built map from showing through — but the layers that would look
// half-built are the ones painted from the count ramp, and those hold at zero
// opacity until the ramp is the one they will keep (see revealData in Map.jsx).
// The basemap is not one of them and is nearly never what the wait is for.
// variant='inline' is the mark alone over a translucent scrim, for a panel or
// section refreshing in place, where a wait of a few hundred milliseconds
// hasn't earned a masthead and the content underneath still means something.
//
// `dismissed` fades the whole splash out — the one way the app's first sight of
// the map can be a fade rather than a jump. Fading the map itself doesn't work:
// its features are painted by MapLibre from per-feature (data-driven) opacity
// ramps, which MapLibre refuses to transition, and a transparent WebGL canvas
// isn't composited at all, so it arrives in one piece whenever it arrives.
// Dissolving what's in front of it costs nothing and reveals the map, the
// legend and the rest of the chrome together. The caller keeps this mounted
// until onDismissed, since an unmount would cut the fade short.
export default function Loading ({ variant = 'brand', dismissed = false, onDismissed }) {
  // Empty outside AppProviders — which is where index.jsx's Suspense fallback
  // renders this, before any of the registry's producers exist.
  const { labelKeys } = useActivity()

  if (variant !== 'brand') {
    return (
      <div className='loading loading-inline'>
        <Spinner />
      </div>
    )
  }

  return (
    <div
      className={`loading loading-brand${dismissed ? ' loading-dismissed' : ''}`}
      // Only the cover's own fade ends the splash: the mark's pulse is an
      // animation rather than a transition, so nothing else here fires this.
      onTransitionEnd={(event) => {
        if (dismissed && event.propertyName === 'opacity') onDismissed?.()
      }}
    >
      {/* The lockup is what the cover centres, and it holds that spot for the
          whole wait: the list of waits hangs off it absolutely, so rows
          arriving and finishing extend the block downwards without ever
          shifting the logo. */}
      <div className='loadingBrand'>
        <CioosLogo layout='stacked' />
        {/* What the wait is actually made of. The splash is the longest wait in
            the app, so it names its parts rather than leaving the user to
            guess. */}
        <ActivityList
          labelKeys={labelKeys}
          className='loadingActivity'
          marks={false}
        />
      </div>
    </div>
  )
}
