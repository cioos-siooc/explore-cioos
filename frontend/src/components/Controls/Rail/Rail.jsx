import React, { useCallback, useMemo, useRef } from 'react'

import useElementSize from '../../ui/useElementSize.js'
import './styles.css'

// The slider every range control in the app is drawn with — the time rail (the
// bar along the bottom of the map, and the Time entry in the Filters panel) and
// the depth rail (the panel's Depth entry, and the strip down the right edge of
// the map). Same track, same teal handles, same tick labels, so setting a depth
// range is recognisably the same act as setting a time range.
//
// Unit-agnostic on purpose: everything it handles is a plain number placed by
// an `axis`, which is the only thing that knows what the numbers mean —
// milliseconds on a warped calendar in one case, metres on a warped water
// column in the other.
//
//   axis: { min, max, minText, maxText, toPos(value) -> 0..1, toValue(0..1) }
//
// It runs either way round. Horizontal is the default and reads left to right;
// vertical reads top to bottom, which is the only way a water column can be
// drawn — the axis minimum is the surface and belongs at the top. Position 0 is
// the axis minimum in both, so nothing but the geometry changes.
//
// Presentational: every value comes in as a prop and every change goes out
// through onCommit.

export default function Rail ({
  axis,
  // [{ key, value, label, valueText, className }] — the draggable marks.
  handles,
  // [{ key, from, to, className, title }] — the stretches drawn on the track
  // behind them: the filled range, and whatever else the caller shades.
  bands = [],
  // (railLengthPx) => [{ key, value, label }]. Given the measured length because
  // which labels fit is a question about pixels, not about values.
  ticksFor,
  // (value, handleKey) => value. Rounding applied to everything committed —
  // whole days, whole metres. Handed the handle because marks on one rail can
  // land on different grids: the filter range walks days, while the marker
  // saying which slice of a gridded dataset is drawn can only land on a node
  // that dataset actually holds.
  snap = (value) => value,
  // (event, handleKey) => step in axis units, so each rail — and each mark on
  // it — sets its own keyboard pace.
  stepFor,
  onCommit,
  orientation = 'horizontal',
  className
}) {
  const vertical = orientation === 'vertical'
  const [trackRef, trackSize] = useElementSize()
  const draggingRef = useRef(null)
  const railLength = vertical ? trackSize.height : trackSize.width

  // Where a pointer sits along the track, 0..1 from the axis minimum.
  const positionFromPointer = useCallback(
    (event) => {
      const rect = trackRef.current?.getBoundingClientRect()
      if (!rect) return 0
      const along = vertical
        ? (event.clientY - rect.top) / rect.height
        : (event.clientX - rect.left) / rect.width
      return Number.isFinite(along) ? Math.min(Math.max(along, 0), 1) : 0
    },
    [vertical]
  )

  const setHandleFromPointer = useCallback(
    (key, event) => {
      onCommit(key, snap(axis.toValue(positionFromPointer(event)), key))
    },
    [axis, positionFromPointer, onCommit, snap]
  )

  function beginDrag (key) {
    return (event) => {
      // Keep the press off the track handler below, and off the browser's own
      // text-selection / scroll gestures while a handle is being dragged.
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      event.currentTarget.focus()
      draggingRef.current = key
    }
  }

  function onHandlePointerMove (event) {
    if (!draggingRef.current) return
    setHandleFromPointer(draggingRef.current, event)
  }

  function endDrag (event) {
    if (!draggingRef.current) return
    draggingRef.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  // A press anywhere on the track moves whichever handle is closest to it, so
  // the common "show me from here" gesture doesn't need the handle grabbed
  // first. Closeness is measured in axis position, not in axis units — that's
  // what the eye is judging on a warped axis.
  function onTrackPointerDown (event) {
    const pos = positionFromPointer(event)
    const nearest = handles.reduce((best, handle) =>
      Math.abs(axis.toPos(handle.value) - pos) <
      Math.abs(axis.toPos(best.value) - pos)
        ? handle
        : best
    )
    setHandleFromPointer(nearest.key, event)
  }

  // Arrows follow the rail: left/right along a horizontal one, up/down along a
  // vertical one, and "up" on a water column means towards the surface. Both
  // pairs are accepted either way round — a key that does nothing on a slider
  // is worse than one that does the obvious thing.
  function onHandleKeyDown (handle) {
    return (event) => {
      const step = stepFor
        ? stepFor(event, handle.key)
        : (axis.max - axis.min) / 100
      let next
      if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) {
        next = handle.value - step
      } else if (['ArrowRight', 'ArrowDown', 'PageDown'].includes(event.key)) {
        next = handle.value + step
      } else if (event.key === 'Home') {
        next = axis.min
      } else if (event.key === 'End') {
        next = axis.max
      } else {
        return
      }
      event.preventDefault()
      onCommit(
        handle.key,
        snap(Math.min(Math.max(next, axis.min), axis.max), handle.key)
      )
    }
  }

  const ticks = useMemo(
    () => (ticksFor ? ticksFor(railLength) : []),
    [ticksFor, railLength]
  )

  // The one place the two orientations differ: which edge a position is
  // measured from, and which way a span is drawn.
  const at = (value) =>
    vertical
      ? { top: `${axis.toPos(value) * 100}%` }
      : { left: `${axis.toPos(value) * 100}%` }
  const span = (from, to) => {
    const start = axis.toPos(from) * 100
    const length = Math.max(axis.toPos(to) - axis.toPos(from), 0) * 100
    return vertical
      ? { top: `${start}%`, height: `${length}%` }
      : { left: `${start}%`, width: `${length}%` }
  }

  return (
    <div
      className={[
        'rail',
        vertical ? 'railVertical' : '',
        className || ''
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div
        className='railTrack'
        ref={trackRef}
        onPointerDown={onTrackPointerDown}
      >
        <div className='railLine' />
        {bands.map(({ key, from, to, className: bandClass, title }) => (
          <div
            key={key}
            className={bandClass}
            title={title}
            style={span(from, to)}
          />
        ))}
        {handles.map((handle) => (
          <button
            key={handle.key}
            type='button'
            role='slider'
            className={`railHandle ${handle.className}`}
            style={at(handle.value)}
            aria-label={handle.label}
            aria-orientation={vertical ? 'vertical' : undefined}
            aria-valuemin={axis.minText ?? axis.min}
            aria-valuemax={axis.maxText ?? axis.max}
            aria-valuenow={handle.value}
            aria-valuetext={handle.valueText ?? String(handle.value)}
            onPointerDown={beginDrag(handle.key)}
            onPointerMove={onHandlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onHandleKeyDown(handle)}
          />
        ))}
      </div>
      <div className='railTicks' aria-hidden='true'>
        {ticks.map(({ key, value, label }) => (
          <span key={key} className='railTick' style={at(value)}>
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}
