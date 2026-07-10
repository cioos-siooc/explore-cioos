import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Stack,
  Activity,
  GeoAltFill,
  GraphUp,
  BarChartSteps,
  Diagram3Fill
} from 'react-bootstrap-icons'

import './styles.css'

// Map-overlay data-type selector: independently show/hide the three data
// families the map serves — Profiles (ERDDAP point/profile/timeseries), OBIS
// biodiversity occurrences, and Trajectories. When Trajectories is on, a
// nested toggle switches its rendering between coverage hexes and track lines
// (the former `tracksMode` button), and reveals the time scrub bar.
export default function LayerSelector({
  dataLayers,
  setDataLayers,
  tracksMode,
  setTracksMode,
  loading
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const toggle = (key) =>
    setDataLayers({ ...dataLayers, [key]: !dataLayers[key] })

  const rows = [
    { key: 'profile', icon: <GeoAltFill size={16} />, label: t('layerProfile') },
    { key: 'timeseries', icon: <GraphUp size={16} />, label: t('layerTimeseries') },
    {
      key: 'timeseriesProfile',
      icon: <BarChartSteps size={16} />,
      label: t('layerTimeseriesProfile')
    },
    { key: 'obis', icon: <Diagram3Fill size={16} />, label: t('layerObis') },
    {
      key: 'trajectories',
      icon: <Activity size={16} />,
      label: t('layerTrajectories')
    }
  ]

  return (
    <div className='layerSelector'>
      <button
        className={`layerSelectorButton ${open ? 'open' : ''}`}
        title={t('layerSelectorLabel')}
        disabled={loading}
        onClick={() => setOpen(!open)}
      >
        <Stack size='24px' />
      </button>
      {open && (
        <div className='layerSelectorPanel'>
          <div className='layerSelectorTitle'>{t('layerSelectorLabel')}</div>
          {rows.map(({ key, icon, label }) => (
            <label key={key} className='layerSelectorRow'>
              <input
                type='checkbox'
                checked={dataLayers[key]}
                onChange={() => toggle(key)}
              />
              <span className='layerSelectorIcon'>{icon}</span>
              <span className='layerSelectorText'>{label}</span>
            </label>
          ))}
          <div className='layerSelectorDivider' />
          {/* Display options (how the data draws, not which data shows). */}
          <label className='layerSelectorRow layerSelectorSub'>
            <input
              type='checkbox'
              checked={dataLayers.hexCells}
              onChange={() => toggle('hexCells')}
            />
            <span className='layerSelectorText'>{t('layerHexCells')}</span>
          </label>
          {dataLayers.trajectories && (
            <label className='layerSelectorRow layerSelectorSub'>
              <input
                type='checkbox'
                checked={tracksMode}
                onChange={() => setTracksMode(!tracksMode)}
              />
              <span className='layerSelectorText'>{t('layerTracksMode')}</span>
            </label>
          )}
        </div>
      )}
    </div>
  )
}
