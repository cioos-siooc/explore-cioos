import * as React from 'react'
import { useTranslation } from 'react-i18next'

import ActivityList from '../ui/ActivityList.jsx'
import { useActivity } from '../../state/activity/ActivityProvider.jsx'
import './activityIndicatorStyles.css'

// The app's single report of background work: one panel in the bottom-right
// corner naming everything currently loading, the map's layers individually.
// It replaced a bottom-centre pill that only knew about the map, and left the
// other loading flags to fend for themselves.
//
// It comes and goes with the work rather than being opened: nothing to click,
// and nothing on screen once there is nothing left to say. The brand logo's
// mark is the standing indicator that anything is happening at all — this
// names the parts, for as long as there are parts to name.
export default function ActivityIndicator () {
  const { t } = useTranslation()
  const { labelKeys, busy, announced } = useActivity()

  return (
    <div className='activityIndicator'>
      {/* `announced` rather than `busy`: a cached filter change resolves inside
          the registry's delay and never flashes the panel open. */}
      {announced && (
        <div className='activityStatus'>
          <p className='activityStatusHeading'>{t('activityStatusHeading')}</p>
          <ActivityList labelKeys={labelKeys} />
        </div>
      )}
      {/* The spoken running commentary, which is the list above whether or not
          it is on screen — so a screen reader hears what is loading without
          having to catch the panel while it is up. */}
      <span className='sr-only' role='status' aria-live='polite'>
        {busy ? labelKeys.map((key) => t(key)).join(', ') : ''}
      </span>
    </div>
  )
}
