import * as React from 'react'
import { useTranslation } from 'react-i18next'

import Spinner from './Spinner.jsx'
import './activityListStyles.css'

// What the app is waiting on, as a list of named waits each with its own mark.
// Presentational on purpose: both callers — the corner status panel and the
// first-paint splash — read the activity registry themselves and hand the keys
// down, so this stays a plain list with no state of its own.
export default function ActivityList ({ labelKeys, className = '' }) {
  const { t } = useTranslation()

  if (!labelKeys.length) return null

  return (
    <ul className={`activityList ${className}`.trim()}>
      {labelKeys.map((key) => (
        <li key={key}>
          <Spinner size='xs' role='presentation' />
          <span>{t(key)}</span>
        </li>
      ))}
    </ul>
  )
}
