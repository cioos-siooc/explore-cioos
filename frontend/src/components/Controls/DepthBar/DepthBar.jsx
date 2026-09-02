import React, { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'react-bootstrap-icons'

import { defaultStartDepth, defaultEndDepth } from '../../config.js'
import { useFilters } from '../../../state/filters/FilterProvider.jsx'
import DepthRail, { DepthField, useDepthAxis } from '../DepthRail/DepthRail.jsx'
import { clampDepth, snapToMetre } from '../DepthRail/depthAxis.js'
import usePublishedFootprint from '../../../state/ui/usePublishedFootprint.js'
import useMediaQuery, { MOBILE_QUERY } from '../../../state/ui/useMediaQuery.js'
import './styles.css'

// How far down the viewport the strip reaches, plus a gap. The map legend drops
// to the bottom of this same edge on narrow screens and caps its own height
// against this, so it stops short of the strip's foot rather than sliding
// under it. Published only while the strip is mounted; the property is cleared
// on unmount, which is what makes the term vanish from the legend's ceiling.
const DEPTH_BAR_STACK_GAP = 8
function measureDepthBarSpace (rect) {
  return rect.bottom + DEPTH_BAR_STACK_GAP
}

// The depth bar: the water column's answer to the time bar, built from the same
// parts but stood upright down the right edge of the map, because that is the
// only way round a water column reads. It carries the depth-range filter —
// two handles bounding what the map, the datasets list and the counts are
// filtered to — and nothing else.
//
// It carried a second mark once: the level of the gridded dataset being drawn,
// so the drawn level could be read against the filtered band. That has moved
// onto the griddap card with the dataset's time slice (see GridSlice), which is
// where the colorbar it changes is; what is left here is the filter, as on the
// bottom bar.
//
// Like the time bar it costs map, so it is only there while the filter is
// narrowing something — otherwise depth is set from the Depth entry in the
// Filters panel and the map keeps the room. That entry is also where the
// ready-made bands live, spelling them out needing width this strip is trying
// not to spend. Not on a phone at all, where the strip would eat a quarter of
// the width and the Filters panel is the one place the range is set.
export default function DepthBar () {
  const { depthFilterActive } = useFilters()
  const isMobile = useMediaQuery(MOBILE_QUERY)

  if (!depthFilterActive || isMobile) return null
  return <DepthBarSurface />
}

function DepthBarSurface () {
  const { t } = useTranslation()
  const { startDepth, setStartDepth, endDepth, setEndDepth } = useFilters()

  const barRef = useRef(null)
  usePublishedFootprint(barRef, '--cioos-depth-bar-space', measureDepthBarSpace)

  // The whole filterable water column, whatever the selection holds: there is
  // no /depthExtent to narrow it to, and it is the same axis the Filters
  // panel's Depth entry draws.
  const axis = useDepthAxis(defaultStartDepth, defaultEndDepth)

  const setHandleValue = useCallback(
    (handle, value) => {
      if (handle === 'start') {
        setStartDepth(clampDepth(value, defaultStartDepth, endDepth))
      } else {
        setEndDepth(clampDepth(value, startDepth, defaultEndDepth))
      }
    },
    [setStartDepth, setEndDepth, startDepth, endDepth]
  )

  return (
    <div
      className='depthBar'
      ref={barRef}
      aria-label={t('depthBarAriaLabel')}
    >
      {/* What the strip is, and the unit every figure on it is in — said once,
          at the top, rather than repeated on each tag. */}
      <div className='depthBarLabel'>{t('depthRangeFilterName')} (m)</div>

      {/* The two figures bounding the filter, sitting at the ends of the rail
          they bound — the shallow one at the top, where the surface is. */}
      <div
        className='depthBarTag depthBarTagRange'
        title={t('depthFilterStartDepth')}
      >
        <DepthField
          label={t('depthFilterStartDepth')}
          value={startDepth}
          min={defaultStartDepth}
          max={endDepth}
          onCommit={(value) => setHandleValue('start', value)}
        />
      </div>

      <DepthRail
        className='depthBarRail'
        orientation='vertical'
        axis={axis}
        startDepth={startDepth}
        endDepth={endDepth}
        onCommit={(handle, value) => setHandleValue(handle, snapToMetre(value))}
      />

      <div
        className='depthBarTag depthBarTagRange'
        title={t('depthFilterEndDepth')}
      >
        <DepthField
          label={t('depthFilterEndDepth')}
          value={endDepth}
          min={startDepth}
          max={defaultEndDepth}
          onCommit={(value) => setHandleValue('end', value)}
        />
      </div>

      {/* The way out, and only that: the ready-made bands belong to the
          Filters panel, where they can be read as words. On a strip this
          narrow the picker was a caret that named nothing, and the rail it
          sits under does the same job by hand. */}
      <button
        type='button'
        className='railReset depthBarReset'
        title={t('depthBarResetRangeTitle')}
        aria-label={t('depthBarResetRangeTitle')}
        onClick={() => {
          setStartDepth(defaultStartDepth)
          setEndDepth(defaultEndDepth)
        }}
      >
        <X size={12} />
      </button>
    </div>
  )
}
