import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import Rail from '../Rail/Rail.jsx'
import { snapToGridNode } from '../../../wmsUtilities'
import {
  createDepthAxis,
  snapToMetre,
  tickDepthsFor,
  MIN_TICK_GAP_PX,
  MIN_TICK_GAP_PX_VERTICAL
} from './depthAxis.js'
import './styles.css'

// The depth slider, built the same way the time one is: the shared Rail, given
// a warped axis, a pair of teal handles and — while a gridded dataset with a
// vertical axis is drawn — the amber marker saying which of its levels the map
// is painting. It appears in the Filters panel as the range alone, and along
// the bottom of the map, above the time bar, as range plus marker.
// Presentational: every value comes in as a prop and every change goes out
// through onCommit.

// Keyboard step per key, in metres. Arrows walk 1 m for the exact figure; the
// coarser steps are what make a 12 km domain navigable without a mouse.
function keyboardStepMetres (event) {
  if (event.key === 'PageUp' || event.key === 'PageDown') return 500
  return event.shiftKey ? 50 : 1
}

// A depth input that lets you finish typing, for the same reason DateField
// does: a controlled field that clamped every keystroke would rewrite "1" as
// the minimum before "1000" could be finished. Nothing is clamped here — a
// value is either complete and in range, in which case it commits, or it is
// still being typed, in which case it is held locally. Leaving with an unusable
// value restores the committed one.
export function isCommittable (value, min, max) {
  if (!/^\d{1,5}$/.test(value)) return false
  const depth = Number(value)
  return depth >= min && depth <= max
}

export function DepthField ({ value, min, max, onCommit, label, className }) {
  const [draft, setDraft] = useState(String(value))
  const [editing, setEditing] = useState(false)

  // Follow the committed value while the field is idle — the rail and the share
  // link both move it — but never while it is being typed into.
  useEffect(() => {
    if (!editing) setDraft(String(value))
  }, [value, editing])

  return (
    <input
      type='number'
      inputMode='numeric'
      className={className || 'railValueInput depthRailNumberInput'}
      aria-label={label}
      value={draft}
      min={min}
      max={max}
      onFocus={() => setEditing(true)}
      onChange={(event) => {
        setDraft(event.target.value)
        if (isCommittable(event.target.value, min, max)) {
          onCommit(Number(event.target.value))
        }
      }}
      onBlur={() => {
        setEditing(false)
        if (isCommittable(draft, min, max)) onCommit(Number(draft))
        else setDraft(String(value))
      }}
    />
  )
}

// The ready-made bands the Range picker offers — the same four the filter has
// always had, which were a row of buttons before the two range filters were
// made one control. Each is a place in the water column rather than a
// thickness, which is why (unlike a time window) dragging one end of a chosen
// band just resizes it.
export const DEPTH_PRESETS = [
  { key: '0-100', start: 0, end: 100, label: '0–100 m' },
  { key: '0-500', start: 0, end: 500, label: '0–500 m' },
  { key: '0-1000', start: 0, end: 1000, label: '0–1000 m' },
  { key: '1000+', start: 1000, end: 12000, label: '1000 m +' }
]

// Which ready-made band the current range is, if any — so the picker shows the
// user's own choice rather than falling back to naming itself.
export function matchDepthPreset (startDepth, endDepth, min, max) {
  if (startDepth === min && endDepth === max) return 'all'
  const match = DEPTH_PRESETS.find(
    (preset) => preset.start === startDepth && preset.end === endDepth
  )
  return match ? match.key : ''
}

// The band picker, one line high, matching the Interval picker in the Time
// filter above it.
export function DepthPresetSelect ({
  startDepth,
  endDepth,
  min,
  max,
  onSelect,
  className,
  ariaLabel
}) {
  const { t } = useTranslation()
  const value = matchDepthPreset(startDepth, endDepth, min, max)
  return (
    <select
      className={className}
      aria-label={ariaLabel}
      title={ariaLabel}
      value={value}
      onChange={(event) => {
        const picked = event.target.value
        if (picked === 'all') onSelect(min, max)
        else if (picked) {
          const preset = DEPTH_PRESETS.find((option) => option.key === picked)
          if (preset) onSelect(preset.start, preset.end)
        }
      }}
    >
      {/* A range set by hand is not one of these, so the closed select falls
          back to naming what it is for. */}
      {!value && (
        <option value='' disabled>
          {t('depthSelectorPresetLabel')}
        </option>
      )}
      <option value='all'>{t('depthSelectorPresetAll')}</option>
      {DEPTH_PRESETS.map(({ key, label }) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </select>
  )
}

// The axis the Filters panel's rail draws: the whole filterable water column,
// the same 0–12000 m whatever the selection holds, since there is no
// /depthExtent to narrow it to. The bar over the map builds its own instead —
// it has a gridded dataset's levels to fit as well.
export function useDepthAxis (min, max) {
  return useMemo(() => createDepthAxis(min, max), [min, max])
}

export default function DepthRail ({
  axis,
  startDepth,
  endDepth,
  // { value, nodes } while a gridded dataset with a vertical axis is drawn on
  // the map: which of its levels is showing, and the levels it has to choose
  // from. The depth twin of the time rail's grid marker, and amber for the same
  // reason — it says where the drawn data *is*, not what is filtered.
  grid,
  onCommit,
  orientation,
  className
}) {
  const { t } = useTranslation()

  const handles = [
    {
      key: 'start',
      value: startDepth,
      valueText: `${startDepth} m`,
      label: t('depthFilterStartDepth'),
      className: 'railHandleRange'
    },
    {
      key: 'end',
      value: endDepth,
      valueText: `${endDepth} m`,
      label: t('depthFilterEndDepth'),
      className: 'railHandleRange'
    },
    ...(grid
      ? [
        {
          key: 'grid',
          value: grid.value,
          valueText: `${grid.value} m`,
          label: t('depthBarGridLabel'),
          className: 'railHandleMarker railHandleGrid'
        }
      ]
      : [])
  ]

  const bands = [
    { key: 'range', from: startDepth, to: endDepth, className: 'railFill' }
  ]

  const ticksFor = useCallback(
    (railLength) =>
      tickDepthsFor(
        railLength,
        axis.anchorDepths,
        axis.toPos,
        orientation === 'vertical' ? MIN_TICK_GAP_PX_VERTICAL : MIN_TICK_GAP_PX
      ).map((depth) => ({
        key: depth,
        value: depth,
        label: depth
      })),
    [axis, orientation]
  )

  return (
    <Rail
      className={className}
      orientation={orientation}
      axis={axis}
      handles={handles}
      bands={bands}
      ticksFor={ticksFor}
      // The range ends land on whole metres; the grid marker lands on the
      // nearest level the dataset holds, so dragging it steps through that
      // dataset rather than past it.
      snap={(depth, handle) =>
        handle === 'grid'
          ? snapToGridNode(grid.nodes, depth)
          : snapToMetre(depth)}
      stepFor={(event, handle) =>
        handle === 'grid'
          ? grid.nodes.step * (event.shiftKey ? 10 : 1)
          : keyboardStepMetres(event)}
      onCommit={onCommit}
    />
  )
}
