import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import Spinner from '../ui/Spinner.jsx'
import Tooltip from '../ui/Tooltip.jsx'
import { useActivity } from '../../state/activity/ActivityProvider.jsx'
import './activityIndicatorStyles.css'

// Don't announce work that resolves this fast — a cached filter change would
// otherwise flash the badge on and straight back off.
const ANNOUNCE_AFTER_MS = 250

// The app's single report of background work: one badge in the bottom-right
// corner, over everything, naming what it is waiting on when hovered or
// focused. It replaced a bottom-centre pill that only knew about the map, and
// left the other seven loading flags to fend for themselves.
export default function ActivityIndicator () {
  const { t } = useTranslation()
  const { labelKeys, busy } = useActivity()
  const [announced, setAnnounced] = useState(false)

  useEffect(() => {
    if (!busy) {
      setAnnounced(false)
      return undefined
    }
    const timer = setTimeout(() => setAnnounced(true), ANNOUNCE_AFTER_MS)
    return () => clearTimeout(timer)
  }, [busy])

  const labels = labelKeys.map((key) => t(key))
  const visible = busy && announced

  // Always mounted, shown by a class: the fade-*out* needs an element that
  // outlives the work it was reporting.
  return (
    <Tooltip
      placement='left'
      delay={150}
      content={
        visible
          ? labels.map((label) => <div key={label}>{label}</div>)
          : undefined
      }
    >
      <div
        className={`activityIndicator${visible ? ' activityIndicatorBusy' : ''}`}
        role='status'
        aria-live='polite'
        aria-label={visible ? labels.join(', ') : undefined}
        tabIndex={visible ? 0 : -1}
      >
        <Spinner size='md' role='presentation' />
      </div>
    </Tooltip>
  )
}
