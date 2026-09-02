import * as React from 'react'
import { useTranslation } from 'react-i18next'

import Spinner from './Spinner.jsx'
import './activityListStyles.css'

// What the app is waiting on, as a list of named waits. Presentational on
// purpose: both callers — the corner status panel and the first-paint splash —
// read the activity registry themselves and hand the keys down, so this stays a
// plain list with no state of its own.
//
// `marks` is the per-row spinner. The corner panel keeps it: it appears beside
// a map the user is already reading, and the marks are what say the rows are
// live. The splash drops it — the lockup above the list is already pulsing, and
// five more copies of the same animation under it is noise, not information.
export default function ActivityList ({ labelKeys, className = '', marks = true }) {
  const { t } = useTranslation()

  if (!labelKeys.length) return null

  const classes = ['activityList', marks ? '' : 'activityList-plain', className]
    .filter(Boolean)
    .join(' ')

  return (
    <ul className={classes}>
      {labelKeys.map((key) => (
        <li key={key}>
          {marks && <Spinner size='xs' role='presentation' />}
          <span>{t(key)}</span>
        </li>
      ))}
    </ul>
  )
}
