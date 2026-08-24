import * as React from 'react'
import PropTypes from 'prop-types'
import { useTranslation } from 'react-i18next'

import { defaultStartDepth, defaultEndDepth } from '../../../config.js'
import DepthRail, {
  DepthField,
  DepthPresetSelect,
  useDepthAxis
} from '../../DepthRail/DepthRail.jsx'
import { clampDepth } from '../../DepthRail/depthAxis.js'
import '../styles.css'

// The Depth filter inside the Filters panel.
//
// It is the Time filter's twin, and deliberately so: both set a range, so both
// are the same three-row form — a ready-made band, a start, an end — over the
// same rail with the same teal handles. Only the axis differs, time running
// left to right and depth running shallow to deep.
//
// The four bands used to be a grid of buttons and the two figures a pair of
// number boxes that could be left in a state the filter refused to apply, with
// a red warning under them. Nothing can be left invalid now: a typed figure
// commits only once it is complete and inside the range the other end allows,
// exactly as a typed date does.
export default function DepthSelector (props) {
  const { t } = useTranslation()
  const { startDepth, endDepth, setStartDepth, setEndDepth } = props

  const axis = useDepthAxis(defaultStartDepth, defaultEndDepth)

  // Either end moves alone, bounded by the other — from the rail and from the
  // fields alike. Unlike a time window, a chosen depth band is a place in the
  // water column rather than a thickness, so dragging one end resizes it
  // instead of sliding the whole band deeper.
  function setHandleValue (handle, value) {
    if (handle === 'start') {
      setStartDepth(clampDepth(value, defaultStartDepth, endDepth))
    } else {
      setEndDepth(clampDepth(value, startDepth, defaultEndDepth))
    }
  }

  return (
    <div className='filterRangeSelector depthSelector'>
      {/* Each field is wrapped in its own <label>, so the text beside it is the
          field's name to a screen reader and a click target to everyone else. */}
      <div className='filterRangeForm'>
        <label className='filterRangeRow'>
          <span className='filterRangeLabel'>
            {t('depthSelectorPresetLabel')}
          </span>
          <DepthPresetSelect
            className='filterRangeInput filterRangeSelect'
            startDepth={startDepth}
            endDepth={endDepth}
            min={defaultStartDepth}
            max={defaultEndDepth}
            onSelect={(start, end) => {
              setStartDepth(start)
              setEndDepth(end)
            }}
          />
        </label>
        <label className='filterRangeRow'>
          <span className='filterRangeLabel'>
            {t('depthFilterStartDepth')}
          </span>
          <DepthField
            className='filterRangeInput'
            value={startDepth}
            min={defaultStartDepth}
            max={endDepth}
            onCommit={(value) => setHandleValue('start', value)}
          />
        </label>
        <label className='filterRangeRow'>
          <span className='filterRangeLabel'>{t('depthFilterEndDepth')}</span>
          <DepthField
            className='filterRangeInput'
            value={endDepth}
            min={startDepth}
            max={defaultEndDepth}
            onCommit={(value) => setHandleValue('end', value)}
          />
        </label>
      </div>
      <DepthRail
        axis={axis}
        startDepth={startDepth}
        endDepth={endDepth}
        onCommit={setHandleValue}
      />
    </div>
  )
}

DepthSelector.propTypes = {
  startDepth: PropTypes.number.isRequired,
  endDepth: PropTypes.number.isRequired,
  setStartDepth: PropTypes.func.isRequired,
  setEndDepth: PropTypes.func.isRequired
}
