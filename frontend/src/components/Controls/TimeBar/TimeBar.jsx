import React, { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { CaretLeftFill, CaretRightFill, X } from 'react-bootstrap-icons'

import {
  defaultStartDate,
  tracksMinDate,
  trailingWindowOptions,
  TRAIL_ALL,
  effectiveTrailingDays
} from '../../config.js'
import { anyTrajectoryLayerOn } from '../../../state/dataLayers.js'
import { useFilters } from '../../../state/filters/FilterProvider.jsx'
import { useMapState } from '../../../state/map/MapStateProvider.jsx'
import {
  getTimeDimension,
  gridAxisNodes,
  snapToGridNode
} from '../../../wmsUtilities'
import TimeRail, {
  DateField,
  IntervalSelect,
  useTimeAxis,
  matchQuickPick,
  slideRange
} from '../TimeRail/TimeRail.jsx'
import GridTimeRail from '../GridTimeRail/GridTimeRail.jsx'
import { MS_PER_DAY, isoToMs, msToIso, clampIso } from '../TimeRail/timeAxis.js'
import usePublishedFootprint from '../../../state/ui/usePublishedFootprint.js'
import useMediaQuery, { MOBILE_QUERY } from '../../../state/ui/useMediaQuery.js'
import './styles.css'

// How far up the bar reaches from the bottom of the viewport: its own offset
// plus its height, which changes with the locale's label lengths, with the
// tighter phone layout, and with which pills are shown. Everything else sitting
// over the lower map — the datasets sidebar, the legend on narrow screens, the
// zoom-to-dataset pill, MapLibre's own bottom-right stack — holds clearance
// from this rather than from a hardcoded height.
function measureBarSpace ({ top, height }) {
  return Math.max(window.innerHeight - top, height)
}

// The time slices of the gridded dataset currently drawn on the map, if it has
// a time axis at all. Its endpoints come from the harvest as ISO strings.
export function gridTimeNodes (overlay) {
  const dimension = getTimeDimension(overlay?.dimensions)
  if (!dimension) return null
  return gridAxisNodes(
    Date.parse(dimension.min),
    Date.parse(dimension.max),
    dimension.n_values
  )
}

// The bottom time bar: one axis carrying every time control the app has.
//
//   * the time-range filter (teal) — two handles bounding what the map, the
//     datasets list and the counts are filtered to;
//   * the trajectory scrub date (purple, only while the track layers are
//     drawing) — the instant each platform's position is drawn at, with its
//     trailing window shaded behind it.
//
// They share an axis but not a value: the scrub deliberately ignores the
// filter range (Map.jsx keeps timeMin/timeMax off the tracks request), so a
// narrow filter never strands the scrub outside its own domain.
//
//   * the gridded dataset's time slice (amber, only while a WMS overlay with a
//     time axis is drawn) — which slice of that grid the map is painting.
//
// The third one gets a rail of its own, stacked above the shared one in the
// same card and spanning only the dataset's own time: a dataset's span is
// usually a sliver of the catalogue's, and a mark on a sliver can be read but
// not moved. What it leaves on the shared rail is a band showing where that
// span falls in the record, which is the part that was worth reading there.
//
// Two floating pieces with map showing between them: the input pills on top,
// the slider card beneath. Full bleed along the bottom edge on phones, a
// centered bubble once there is room for one.
//
// It costs a strip of map, so it is only there when it has something to say:
// a time filter narrowing what is drawn, trajectories being dated by the
// scrub, or a grid whose slice can be stepped through. With none of them, the
// range is set from the Time entry in the Filters panel and the map keeps the
// room.
//
// On a phone the filter alone no longer buys the bar its strip of map: the Time
// entry in the Filters panel is the one place the range is set there, which is
// the whole of what a phone-sized rail could do anyway. The scrub and the grid
// slice still mount it, because those two controls exist nowhere else.
export default function TimeBar () {
  const { timeFilterActive } = useFilters()
  const { tracksMode, dataLayers, activeWmsOverlay } = useMapState()
  const isMobile = useMediaQuery(MOBILE_QUERY)

  const scrubActive = tracksMode && anyTrajectoryLayerOn(dataLayers)
  const gridNodes = gridTimeNodes(activeWmsOverlay)
  const filterWantsBar = timeFilterActive && !isMobile
  if (!filterWantsBar && !scrubActive && !gridNodes) return null

  return <TimeBarSurface scrubActive={scrubActive} gridNodes={gridNodes} />
}

// Split out so the bar's footprint is published by a component that only
// exists while the bar does: the property is cleared on unmount, which is what
// lets the sidebar, the legend and MapLibre's corners reclaim the bottom edge
// the moment it goes away.
function TimeBarSurface ({ scrubActive, gridNodes }) {
  const { t } = useTranslation()
  const {
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    timeFilterActive,
    timeExtent
  } = useFilters()
  const {
    zoom,
    scrubTime,
    setScrubTime,
    trailingDays,
    setTrailingDays,
    activeWmsOverlay,
    setActiveWmsOverlay
  } = useMapState()

  const barRef = useRef(null)
  usePublishedFootprint(barRef, '--cioos-time-bar-space', measureBarSpace)

  // Where the grid marker sits, and the pill's reading of it. The overlay's
  // own time is what the map is painting; it is snapped here because a share
  // link or the harvest could hand over something between two slices.
  const gridTimeMs = gridNodes
    ? snapToGridNode(gridNodes, Date.parse(activeWmsOverlay.time))
    : null
  const gridIso = gridNodes ? new Date(gridTimeMs).toISOString() : undefined
  // A grid with slices closer together than a day has a time of day worth
  // showing; a daily or monthly one does not, and the date says it all.
  const gridSubDaily = gridNodes && gridNodes.step < MS_PER_DAY

  // Which slice of the grid the marker is on, counted from the first — the one
  // reading its date can't give, and the one that says how much room there is
  // to move.
  const gridIndex = gridNodes
    ? Math.round((gridTimeMs - gridNodes.min) / gridNodes.step)
    : 0

  const { axis, maxIso, domainStart, domainEnd } = useTimeAxis({
    timeExtent,
    timeFilterActive,
    startDate,
    endDate,
    includeToday: scrubActive
  })

  // The scrub has its own floor (the tracks only go back so far) but can never
  // leave the drawn axis either.
  const scrubMinIso = tracksMinDate > domainStart ? tracksMinDate : domainStart
  const scrubIso = clampIso(scrubTime, scrubMinIso, domainEnd)

  // Zoomed out, the long windows load clamped (see effectiveTrailingDays), so
  // say so on the picker rather than let the choice look like it did nothing.
  const loadedTrailDays = effectiveTrailingDays(trailingDays, zoom)
  const zoomClamped = loadedTrailDays !== trailingDays

  // A chosen window is a window, so the rail moves it as one: dragging either
  // end takes the other with it and the span keeps its length. Typing a date
  // still moves that one end on its own — and the span it leaves behind is no
  // longer one of the ready-made ones, which is what releases the hold.
  const windowLocked = !['', 'all'].includes(
    matchQuickPick(startDate, endDate, defaultStartDate)
  )

  // What the typed date fields do. Each moves its own end, bounded by the other
  // and by the filter's own legal domain rather than by the drawn axis: a date
  // typed in here may reach outside the data, and then widens the axis to meet
  // it.
  const setFieldValue = useCallback(
    (handle, iso) => {
      if (handle === 'start') setStartDate(clampIso(iso, defaultStartDate, endDate))
      else setEndDate(clampIso(iso, startDate, maxIso))
    },
    [setStartDate, setEndDate, startDate, endDate, maxIso]
  )

  // What the rail does: the same, except that a dragged handle can't leave the
  // axis in the first place, that a chosen window moves whole, and that the
  // scrub — which only ever lives on the rail — has its own bounds.
  const setHandleValue = useCallback(
    (handle, iso) => {
      if (handle === 'grid') {
        setActiveWmsOverlay({ ...activeWmsOverlay, time: iso })
      } else if (handle === 'scrub') {
        setScrubTime(clampIso(iso, scrubMinIso, domainEnd))
      } else if (windowLocked) {
        const { start, end } = slideRange(handle, iso, {
          startDate,
          endDate,
          minIso: defaultStartDate,
          maxIso
        })
        setStartDate(start)
        setEndDate(end)
      } else {
        setFieldValue(handle, iso)
      }
    },
    [
      setFieldValue,
      setStartDate,
      setEndDate,
      setScrubTime,
      windowLocked,
      startDate,
      endDate,
      maxIso,
      scrubMinIso,
      domainEnd,
      activeWmsOverlay,
      setActiveWmsOverlay
    ]
  )

  // One slice forward or back, whatever the rail's scale — the grids that hold
  // thousands of slices give each of them well under a pixel, and picking one
  // out is what this control is for.
  function stepGrid (delta) {
    setHandleValue(
      'grid',
      new Date(
        snapToGridNode(gridNodes, gridTimeMs + delta * gridNodes.step)
      ).toISOString()
    )
  }

  return (
    <div className='timeBar' ref={barRef} aria-label={t('timeBarAriaLabel')}>
      {/* One row for the input groups, above the sliders they drive. Each is
          named, and tinted in the colour of its handle — the label says which
          control it is, the colour says which mark on the rail it moves. */}
      <div className='timeBarFields'>
        <div className='railField railFieldRange' role='group'>
          <span className='railFieldLabel'>{t('timeBarRangeLabel')}</span>
          <DateField
            label={t('timeSelectorStartDate')}
            value={startDate}
            min={defaultStartDate}
            max={endDate}
            onCommit={(value) => setFieldValue('start', value)}
          />
          <span className='railFieldSep'>–</span>
          <DateField
            label={t('timeSelectorEndDate')}
            value={endDate}
            min={startDate}
            max={maxIso}
            onCommit={(value) => setFieldValue('end', value)}
          />
          {/* The ready-made windows the Filters panel spells out as a labelled
              row. There is no room for a label here, so the picker names itself
              until a window is chosen. */}
          <IntervalSelect
            className='railPresetSelect'
            ariaLabel={t('timeBarPresetLabel')}
            startDate={startDate}
            endDate={endDate}
            defaultStart={defaultStartDate}
            maxIso={maxIso}
            onSelect={(start, end) => {
              setStartDate(start)
              setEndDate(end)
            }}
          />
          {timeFilterActive && (
            <button
              type='button'
              className='railReset'
              title={t('timeBarResetRangeTitle')}
              aria-label={t('timeBarResetRangeTitle')}
              onClick={() => {
                setStartDate(defaultStartDate)
                setEndDate(maxIso)
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {scrubActive && (
          <div className='railField railFieldScrub' role='group'>
            <span className='railFieldLabel'>{t('timeBarScrubLabel')}</span>
            <DateField
              label={t('timeBarScrubLabel')}
              value={scrubIso}
              min={scrubMinIso}
              max={domainEnd}
              onCommit={(value) => setHandleValue('scrub', value)}
            />
            {/* The trail window: its own name is dropped — every option reads as
                a duration already — but it keeps the tooltip that explains a
                window the zoom gate is currently clamping. */}
            <select
              className='timeRailTrailSelect'
              aria-label={t('timeBarTrailingWindowLabel')}
              title={
                zoomClamped
                  ? t('legendTrackTrailZoomGated')
                  : t('timeBarTrailingWindowLabel')
              }
              value={trailingDays}
              onChange={(event) =>
                setTrailingDays(
                  event.target.value === TRAIL_ALL
                    ? TRAIL_ALL
                    : Number(event.target.value)
                )
              }
            >
              {trailingWindowOptions.map((days) => (
                <option key={days} value={days}>
                  {days === TRAIL_ALL
                    ? t('timeBarTrailAll')
                    : days === 365
                      ? t('timeBarOneYear')
                      : `${days} ${t('timeBarDays')}`}
                </option>
              ))}
            </select>
            {zoomClamped && (
              <span
                className='timeRailTrailClamped'
                title={t('legendTrackTrailZoomGated')}
              >
                *
              </span>
            )}
          </div>
        )}

        {/* The gridded dataset's own slice, in the same row and the same pill
            as the others: it is a date being set over the map like the rest of
            them. What it adds is a way through the slices one at a time —
            grids that hold thousands give each slice well under a pixel of any
            rail — and where the drawn one sits among them. */}
        {gridNodes && (
          <div className='railField railFieldGrid' role='group'>
            <span className='railFieldLabel'>{t('timeBarGridLabel')}</span>
            <button
              type='button'
              className='railStep'
              title={t('timeBarGridPrevSlice')}
              aria-label={t('timeBarGridPrevSlice')}
              disabled={gridIndex === 0}
              onClick={() => stepGrid(-1)}
            >
              <CaretLeftFill size={11} />
            </button>
            <DateField
              label={t('timeBarGridLabel')}
              value={gridIso.slice(0, 10)}
              min={msToIso(gridNodes.min)}
              max={msToIso(gridNodes.max)}
              // A typed date names a day; which of that day's slices it lands
              // on is the rail's business, and the clock beside it reports the
              // answer.
              onCommit={(value) => setHandleValue('grid', `${value}T00:00:00Z`)}
            />
            {gridSubDaily && (
              <span className='timeRailClock'>{gridIso.slice(11, 16)}</span>
            )}
            <button
              type='button'
              className='railStep'
              title={t('timeBarGridNextSlice')}
              aria-label={t('timeBarGridNextSlice')}
              disabled={gridIndex === gridNodes.count - 1}
              onClick={() => stepGrid(1)}
            >
              <CaretRightFill size={11} />
            </button>
            <span
              className='timeBarGridCount'
              title={t('timeBarGridSliceTitle', {
                index: gridIndex + 1,
                total: gridNodes.count
              })}
            >
              {gridIndex + 1} / {gridNodes.count}
            </span>
          </div>
        )}
      </div>

      {/* Both sliders, one card: the dataset's own axis on top when there is a
          grid on the map, the catalogue's underneath. Stacked rather than
          merged — the grid's span is usually a sliver of the catalogue's, and
          a mark on a sliver cannot be moved — but kept in the same surface,
          since they are read together and the pills above drive both. */}
      <div className='timeBarSlider'>
        {gridNodes && (
          <GridTimeRail
            className='timeBarGridRail'
            nodes={gridNodes}
            value={gridIso}
            onCommit={(iso) => setHandleValue('grid', iso)}
          />
        )}
        <TimeRail
          axis={axis}
          startDate={startDate}
          endDate={endDate}
          scrub={
            scrubActive
              ? {
                value: scrubIso,
                // The stretch of history the tracks actually cover behind the
                // scrub date — the same window the tiles are built from,
                // clamp included.
                trailStartMs: Math.max(
                  isoToMs(scrubIso) - loadedTrailDays * MS_PER_DAY,
                  isoToMs(scrubMinIso)
                )
              }
              : undefined
          }
          gridSpan={
            gridNodes
              ? { fromMs: gridNodes.min, toMs: gridNodes.max }
              : undefined
          }
          onCommit={setHandleValue}
        />
      </div>
    </div>
  )
}
