import React from 'react'
import Slider from 'rc-slider'
import 'rc-slider/assets/index.css'
import { Dropdown } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'

import { tracksMinDate, trailingWindowOptions, TRAIL_ALL } from '../../config.js'
import './styles.css'

const MS_PER_DAY = 24 * 60 * 60 * 1000

function dateToEpochDay(isoDate) {
  return Math.floor(new Date(`${isoDate}T00:00:00Z`).getTime() / MS_PER_DAY)
}

function epochDayToDate(epochDay) {
  return new Date(epochDay * MS_PER_DAY).toISOString().split('T')[0]
}

// Bottom scrub bar for tracks mode: pick a date T; the map shows each
// platform's position at T plus its trailing track for the last N days.
// Manual slider only (no playback). Values snap to whole UTC days so the
// tile requests stay cache-friendly.
export default function TimeBar({
  scrubTime,
  setScrubTime,
  trailingDays,
  setTrailingDays,
  smoothTracks,
  setSmoothTracks
}) {
  const { t } = useTranslation()

  const minDay = dateToEpochDay(tracksMinDate)
  const maxDay = dateToEpochDay(new Date().toISOString().split('T')[0])
  const valueDay = dateToEpochDay(scrubTime)

  // Year marks: January 1st every 5 years across the domain.
  const marks = {}
  const startYear = new Date(`${tracksMinDate}T00:00:00Z`).getUTCFullYear()
  const endYear = new Date().getUTCFullYear()
  for (let year = startYear; year <= endYear; year += 5) {
    marks[dateToEpochDay(`${year}-01-01`)] = `${year}`
  }

  return (
    <div className='timeBar'>
      <div className='timeBarDate'>{scrubTime}</div>
      <div className='timeBarSlider'>
        <Slider
          min={minDay}
          max={maxDay}
          value={valueDay}
          onChange={(value) => setScrubTime(epochDayToDate(value))}
          marks={marks}
          railStyle={{ height: 4 }}
          handleStyle={{ height: 18, width: 18, marginTop: -7 }}
        />
      </div>
      <div className='timeBarControls'>
        <Dropdown>
          <Dropdown.Toggle size='sm' variant='outline-secondary'>
            {t('timeBarTrailingWindowLabel')}:{' '}
            {trailingDays === TRAIL_ALL ? t('timeBarTrailAll') : `${trailingDays}d`}
          </Dropdown.Toggle>
          <Dropdown.Menu>
            {trailingWindowOptions.map((days) => (
              <Dropdown.Item
                key={days}
                active={days === trailingDays}
                onClick={() => setTrailingDays(days)}
              >
                {days === TRAIL_ALL
                  ? t('timeBarTrailAll')
                  : `${days} ${t('timeBarDays')}`}
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        </Dropdown>
        <label className='timeBarSmoothing' title={t('trackSmoothingTooltip')}>
          <input
            type='checkbox'
            checked={smoothTracks}
            onChange={(e) => setSmoothTracks(e.target.checked)}
          />
          {t('trackSmoothingLabel')}
        </label>
      </div>
    </div>
  )
}
