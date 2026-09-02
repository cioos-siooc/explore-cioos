import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ActivityList from '../ui/ActivityList.jsx'
import Spinner from '../ui/Spinner.jsx'
import { useActivity } from '../../state/activity/ActivityProvider.jsx'
import './activityIndicatorStyles.css'

// Don't announce work that resolves this fast — a cached filter change would
// otherwise flash the badge on and straight back off.
const ANNOUNCE_AFTER_MS = 250

// The app's single report of background work: one badge in the bottom-right
// corner that toggles a list of what is currently loading, naming the map's
// layers individually. It replaced a bottom-centre pill that only knew about
// the map, and left the other loading flags to fend for themselves.
export default function ActivityIndicator () {
  const { t } = useTranslation()
  const { labelKeys, busy } = useActivity()
  const [announced, setAnnounced] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!busy) {
      setAnnounced(false)
      return undefined
    }
    const timer = setTimeout(() => setAnnounced(true), ANNOUNCE_AFTER_MS)
    return () => clearTimeout(timer)
  }, [busy])

  // The badge is always on screen and always clickable — it is a control, and
  // one that only appeared while something happened to be loading would be
  // unusable for the fast loads that are most of them. Idle it just recedes:
  // faded, and holding the mark still. The announce delay gates the emphasis
  // rather than the badge itself, so a cached load doesn't strobe it.
  const emphasised = busy && announced

  return (
    <div
      className={`activityIndicator${
        emphasised ? ' activityIndicatorBusy' : ''
      }`}
    >
      {/* Only ever shown with something in it: an empty box saying nothing is
          loading is noise, so toggling it on while idle arms it for the next
          load rather than opening an empty panel. */}
      {open && labelKeys.length > 0 && (
        <div className='activityStatus' id='activityStatus'>
          <p className='activityStatusHeading'>{t('activityStatusHeading')}</p>
          <ActivityList labelKeys={labelKeys} />
        </div>
      )}
      <button
        type='button'
        className='activityIndicatorToggle'
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls='activityStatus'
        title={t(open ? 'activityHideStatus' : 'activityShowStatus')}
      >
        <Spinner size='md' role='presentation' />
      </button>
      {/* The spoken running commentary, which is the list above whether or not
          it is on screen — so a screen reader hears what is loading without
          having to find and open the panel. */}
      <span className='sr-only' role='status' aria-live='polite'>
        {busy ? labelKeys.map((key) => t(key)).join(', ') : ''}
      </span>
    </div>
  )
}
