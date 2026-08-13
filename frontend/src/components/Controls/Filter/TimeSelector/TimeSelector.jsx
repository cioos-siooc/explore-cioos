import * as React from 'react'
import PropTypes from 'prop-types'
import { useTranslation } from 'react-i18next'

import { defaultStartDate } from '../../../config.js'
import { useFilters } from '../../../../state/filters/FilterProvider.jsx'
import TimeRail, {
  DateField,
  IntervalSelect,
  useTimeAxis,
  matchQuickPick,
  slideRange
} from '../../TimeRail/TimeRail.jsx'
import { clampIso, todayIso } from '../../TimeRail/timeAxis.js'
import '../styles.css'

// The Time filter inside the Filters panel.
//
// It is the same control as the bar along the bottom of the map — the same
// warped axis, the same teal handles, the same typeable dates, the same
// ready-made windows — because it sets the same two values. What differs is the
// shape they take. Over the map they are a pill that reads as a label until
// pointed at, because they are sitting on the map; in here there is room to
// spell them out, so they are a plain three-row form: a label, a field, one row
// per thing being set, like every other field in the panel.
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

  // Typing in a field moves that end alone, bounded by the other.
  function setFieldValue (handle, iso) {
    if (handle === 'start') setStartDate(clampIso(iso, defaultStartDate, endDate))
    else setEndDate(clampIso(iso, startDate, maxIso))
  }

  // A chosen window moves whole: on the rail, dragging either end takes the
  // other with it and the window keeps its length. Typing a date is still free
  // to change that length, and doing so is what releases the hold — the same
  // rule as the bar over the map.
  const windowLocked = !['', 'all'].includes(
    matchQuickPick(startDate, endDate, defaultStartDate)
  )

  function setHandleValue (handle, iso) {
    if (!windowLocked) {
      setFieldValue(handle, iso)
      return
    }
    const { start, end } = slideRange(handle, iso, {
      startDate,
      endDate,
      minIso: defaultStartDate,
      maxIso
    })
    setStartDate(start)
    setEndDate(end)
  }

  return (
    <div className='filterRangeSelector timeSelector'>
      {/* Each field is wrapped in its own <label>, so the text beside it is the
          field's name to a screen reader and a click target to everyone else —
          no aria-label standing in for a label that is right there. */}
      <div className='filterRangeForm'>
        <label className='filterRangeRow'>
          <span className='filterRangeLabel'>{t('timeBarPresetLabel')}</span>
          <IntervalSelect
            className='filterRangeInput filterRangeSelect'
            startDate={startDate}
            endDate={endDate}
            defaultStart={defaultStartDate}
            maxIso={maxIso}
            onSelect={(start, end) => {
              setStartDate(start)
              setEndDate(end)
            }}
          />
        </label>
        <label className='filterRangeRow'>
          <span className='filterRangeLabel'>
            {t('timeSelectorStartDate')}
          </span>
          <DateField
            className='timeRailDateInput filterRangeInput'
            value={startDate}
            min={defaultStartDate}
            max={endDate}
            onCommit={(value) => setFieldValue('start', value)}
          />
        </label>
        <label className='filterRangeRow'>
          <span className='filterRangeLabel'>{t('timeSelectorEndDate')}</span>
          <DateField
            className='timeRailDateInput filterRangeInput'
            value={endDate}
            min={startDate}
            max={maxIso}
            onCommit={(value) => setFieldValue('end', value)}
          />
        </label>
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
