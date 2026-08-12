import * as React from 'react'
import PropTypes from 'prop-types'
import { useTranslation } from 'react-i18next'

import { defaultStartDate } from '../../../config.js'
import { useFilters } from '../../../../state/filters/FilterProvider.jsx'
import TimeRail, {
  DateField,
  useTimeAxis,
  QUICK_PICKS,
  lastDaysRange
} from '../../TimeRail/TimeRail.jsx'
import { clampIso, todayIso } from '../../TimeRail/timeAxis.js'
import './styles.css'

// The Time filter inside the Filters panel.
//
// It is the same control as the bar along the bottom of the map — the same
// warped axis, the same teal handles, the same typeable date fields, the same
// ready-made windows — because it sets the same two values. The only
// difference is the shape those windows take: a row of buttons here, where
// there is room for one, and a dropdown in the bar, where there is not.
export default function TimeSelector (props) {
  const { t } = useTranslation()
  const { timeExtent, timeFilterActive } = useFilters()
  const { startDate, endDate, setStartDate, setEndDate } = props

  const maxIso = todayIso()
  // Same axis the bar over the map draws, for the same reason: it spans the
  // data the current selection covers, and only widens past that when the
  // filter itself has been set outside it.
  const { axis } = useTimeAxis({
    timeExtent,
    timeFilterActive,
    startDate,
    endDate
  })

  function setHandleValue (handle, iso) {
    if (handle === 'start') setStartDate(clampIso(iso, defaultStartDate, endDate))
    else setEndDate(clampIso(iso, startDate, maxIso))
  }

  function selectLastDays (days) {
    const { start, end } = lastDaysRange(days)
    setStartDate(start)
    setEndDate(end)
  }

  return (
    <div className='timeSelector'>
      <div className='depthQuickSelectGrid'>
        {QUICK_PICKS.map(({ days, labelKey }) => (
          <button key={days} onClick={() => selectLastDays(days)}>
            {t(labelKey)}
          </button>
        ))}
      </div>
      <div className='timeSelectorRange'>
        <div className='timeRailField timeRailFieldRange'>
          <DateField
            label={t('timeSelectorStartDate')}
            value={startDate}
            min={defaultStartDate}
            max={endDate}
            onCommit={(value) => setHandleValue('start', value)}
          />
          <span className='timeRailFieldSep'>–</span>
          <DateField
            label={t('timeSelectorEndDate')}
            value={endDate}
            min={startDate}
            max={maxIso}
            onCommit={(value) => setHandleValue('end', value)}
          />
        </div>
      </div>
      <TimeRail
        axis={axis}
        startDate={startDate}
        endDate={endDate}
        onCommit={setHandleValue}
      />
    </div>
  )
}

TimeSelector.propTypes = {
  startDate: PropTypes.string.isRequired,
  endDate: PropTypes.string.isRequired,
  setStartDate: PropTypes.func.isRequired,
  setEndDate: PropTypes.func.isRequired
}
