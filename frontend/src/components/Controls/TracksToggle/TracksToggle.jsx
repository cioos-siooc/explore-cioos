import React from 'react'
import { useTranslation } from 'react-i18next'
import { Activity } from 'react-bootstrap-icons'

import './styles.css'

// Map-overlay toggle for tracks mode: swaps the trajectory coverage hexes
// for track-line rendering and reveals the time scrub bar.
export default function TracksToggle({ tracksMode, setTracksMode, loading }) {
  const { t } = useTranslation()

  return (
    <button
      className={`tracksToggleButton ${tracksMode ? 'active' : ''}`}
      id='tracksToggleButton'
      title={t('tracksToggleLabel')}
      disabled={loading}
      onClick={() => setTracksMode(!tracksMode)}
    >
      <Activity size='26px' />
    </button>
  )
}
