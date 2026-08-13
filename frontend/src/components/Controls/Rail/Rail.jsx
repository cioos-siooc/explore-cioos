import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import './styles.css'

// The slider both range filters are drawn with — the time rail (the bar along
// the bottom of the map, and the Time entry in the Filters panel) and the depth
// rail in the panel beside it. Same track, same teal handles, same tick row, so
// setting a depth range is recognisably the same act as setting a time range.
//
// Unit-agnostic on purpose: everything it handles is a plain number placed by
// an `axis`, which is the only thing that knows what the numbers mean —
// milliseconds on a warped calendar in one case, metres on a warped water
// column in the other.
//
//   axis: { min, max, minText, maxText, toPos(value) -> 0..1, toValue(0..1) }
//
// Presentational: every value comes in as a prop and every change goes out
// through onCommit.

function useMeasuredWidth (ref) {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const publish = () => setWidth(el.getBoundingClientRect().width)
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return width
}

export default function Rail ({
  axis,
  // [{ key, value, label, valueText, className }] — the draggable marks.
  handles,
  // [{ key, from, to, className, title }] — the stretches drawn on the track
  // behind them: the filled range, and whatever else the caller shades.
  bands = [],
  // (railWidthPx) => [{ key, value, label }]. Given the measured width because
  // which labels fit is a question about pixels, not about values.
  ticksFor,
  // Rounding applied to everything committed — whole days, whole metres.
  snap = (value) => value,
  // (event) => step in axis units, so each rail sets its own keyboard pace.
  stepFor,
  onCommit,
  className
}) {
  const trackRef = useRef(null)
  const draggingRef = useRef(null)
  const railWidth = useMeasuredWidth(trackRef)

  const positionFromClientX = useCallback((clientX) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || !rect.width) return 0
    return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)
  }, [])

  const setHandleFromClientX = useCallback(
    (key, clientX) => {
      onCommit(key, snap(axis.toValue(positionFromClientX(clientX))))
    },
    [axis, positionFromClientX, onCommit, snap]
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
    setHandleFromClientX(draggingRef.current, event.clientX)
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
    const pos = positionFromClientX(event.clientX)
    const nearest = handles.reduce((best, handle) =>
      Math.abs(axis.toPos(handle.value) - pos) <
      Math.abs(axis.toPos(best.value) - pos)
        ? handle
        : best
    )
    setHandleFromClientX(nearest.key, event.clientX)
  }

  function onHandleKeyDown (handle) {
    return (event) => {
      const step = stepFor
        ? stepFor(event)
        : (axis.max - axis.min) / 100
      let next
      if (event.key === 'ArrowLeft' || event.key === 'PageDown') {
        next = handle.value - step
      } else if (event.key === 'ArrowRight' || event.key === 'PageUp') {
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
        snap(Math.min(Math.max(next, axis.min), axis.max))
      )
    }
  }

  const ticks = useMemo(
    () => (ticksFor ? ticksFor(railWidth) : []),
    [ticksFor, railWidth]
  )

  return (
    <div className={className ? `rail ${className}` : 'rail'}>
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
            style={{
              left: `${axis.toPos(from) * 100}%`,
              width: `${Math.max(axis.toPos(to) - axis.toPos(from), 0) * 100}%`
            }}
          />
        ))}
        {handles.map((handle) => (
          <button
            key={handle.key}
            type='button'
            role='slider'
            className={`railHandle ${handle.className}`}
            style={{ left: `${axis.toPos(handle.value) * 100}%` }}
            aria-label={handle.label}
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
          <span
            key={key}
            className='railTick'
            style={{ left: `${axis.toPos(value) * 100}%` }}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}
