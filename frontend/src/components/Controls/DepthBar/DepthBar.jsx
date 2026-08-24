import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'react-bootstrap-icons'

import { defaultStartDepth, defaultEndDepth } from '../../config.js'
import { useFilters } from '../../../state/filters/FilterProvider.jsx'
import { useMapState } from '../../../state/map/MapStateProvider.jsx'
import {
  getVerticalDimension,
  gridAxisNodes,
  snapToGridNode,
  toElevation
} from '../../../wmsUtilities'
import DepthRail, { DepthField } from '../DepthRail/DepthRail.jsx'
import { createDepthAxis, clampDepth, snapToMetre } from '../DepthRail/depthAxis.js'
import './styles.css'

// The levels of the gridded dataset currently drawn, in depth — positive down,
// which is what the rail and the filter both work in. ERDDAP's WMS ELEVATION is
// altitude, so the two are each other's negation whichever way round the
// dataset labels its own axis, and the endpoints swap over on an altitude grid.
export function gridDepthNodes (overlay) {
  const dimension = getVerticalDimension(overlay?.dimensions)
  if (!dimension) return null
  const ends = [dimension.min, dimension.max].map(
    (value) => -toElevation(dimension, value)
  )
  return gridAxisNodes(
    Math.min(...ends),
    Math.max(...ends),
    dimension.n_values
  )
}

// The depth bar: the water column's answer to the time bar, built from the same
// parts but stood upright down the right edge of the map, because that is the
// only way round a water column reads.
//
//   * the depth-range filter (teal) — two handles bounding what the map, the
//     datasets list and the counts are filtered to;
//   * the gridded dataset's level (amber, only while a WMS overlay with a
//     vertical axis is drawn) — which level of that grid the map is painting.
//
// Like the time bar it costs map, so it is only there when it has something to
// say: a depth filter narrowing what is drawn, or a grid whose level can be
// stepped through. With neither, depth is set from the Depth entry in the
// Filters panel and the map keeps the room. That entry is also where the
// ready-made bands live — spelling them out needs width this strip is trying
// not to spend.
export default function DepthBar () {
  const { depthFilterActive } = useFilters()
  const { activeWmsOverlay } = useMapState()

  const gridNodes = gridDepthNodes(activeWmsOverlay)
  if (!depthFilterActive && !gridNodes) return null

  return <DepthBarSurface gridNodes={gridNodes} />
}

function DepthBarSurface ({ gridNodes }) {
  const { t } = useTranslation()
  const {
    startDepth,
    setStartDepth,
    endDepth,
    setEndDepth,
    depthFilterActive
  } = useFilters()
  const { activeWmsOverlay, setActiveWmsOverlay } = useMapState()

  // What the rail spans. With a filter on, the whole filterable column, so its
  // handles can be dragged anywhere they are allowed to go; with only a grid on
  // the map, that grid's own levels, so a dataset living in the top 50 m gets
  // the whole rail to be stepped through rather than a sliver of one. Either
  // way it stretches to hold the grid — a marker the axis can't represent is a
  // marker that can't be dragged.
  const domain = useMemo(() => {
    const base = depthFilterActive || !gridNodes
      ? [defaultStartDepth, defaultEndDepth]
      : [Math.min(defaultStartDepth, gridNodes.min), gridNodes.max]
    if (!gridNodes) return base
    return [Math.min(base[0], gridNodes.min), Math.max(base[1], gridNodes.max)]
  }, [depthFilterActive, gridNodes])

  const axis = useMemo(() => createDepthAxis(domain[0], domain[1]), [domain])

  // Where the grid marker sits. The overlay's elevation is what the map is
  // painting; it is snapped here because a share link or the harvest could
  // hand over something between two levels.
  const gridDepth = gridNodes
    ? snapToGridNode(gridNodes, -activeWmsOverlay.elevation)
    : null

  const verticalDimension = getVerticalDimension(activeWmsOverlay?.dimensions)

  const setHandleValue = useCallback(
    (handle, value) => {
      if (handle === 'grid') {
        setActiveWmsOverlay({
          ...activeWmsOverlay,
          // Back to altitude for the WMS request, which is the only place the
          // sign convention matters.
          elevation: -snapToGridNode(gridNodes, value)
        })
      } else if (handle === 'start') {
        setStartDepth(clampDepth(value, defaultStartDepth, endDepth))
      } else {
        setEndDepth(clampDepth(value, startDepth, defaultEndDepth))
      }
    },
    [
      setStartDepth,
      setEndDepth,
      startDepth,
      endDepth,
      gridNodes,
      activeWmsOverlay,
      setActiveWmsOverlay
    ]
  )

  return (
    <div className='depthBar' aria-label={t('depthBarAriaLabel')}>
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
        grid={gridNodes ? { value: gridDepth, nodes: gridNodes } : undefined}
        onCommit={(handle, value) =>
          setHandleValue(handle, handle === 'grid' ? value : snapToMetre(value))}
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

      {/* The gridded dataset's own level. It used to be a bare range input in
          the legend card, numbered by node index; here it is in metres, on the
          same axis as the depth filter, so how the drawn level sits against the
          filtered band is visible rather than being something to work out. */}
      {gridNodes && (
        <div
          className='depthBarTag depthBarTagGrid'
          title={t('depthBarGridLabel')}
        >
          <DepthField
            label={t('depthBarGridLabel')}
            value={Math.round(gridDepth)}
            min={Math.ceil(gridNodes.min)}
            max={Math.floor(gridNodes.max)}
            onCommit={(value) => setHandleValue('grid', value)}
          />
          {verticalDimension?.units && verticalDimension.units !== 'm' && (
            <span className='depthBarUnits'>{verticalDimension.units}</span>
          )}
        </div>
      )}

      {/* The way out of a filter that is on, and only that: the ready-made
          bands belong to the Filters panel, where they can be read as words.
          On a strip this narrow the picker was a caret that named nothing, and
          the rail it sat under does the same job by hand. */}
      {depthFilterActive && (
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
      )}
    </div>
  )
}
