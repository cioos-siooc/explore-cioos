import React, { useCallback, useMemo, useRef } from "react";

import useElementSize from "../../ui/useElementSize.js";
import "./styles.css";

// Unit-agnostic: only `axis` knows what the numbers mean.
//   axis: { min, max, minText, maxText, toPos(value) -> 0..1, toValue(0..1) }
// Position 0 is the axis minimum in both orientations (top when vertical).

export default function Rail({
  axis,
  // [{ key, value, label, valueText, className }] — the draggable marks.
  handles,
  // [{ key, from, to, className, title }] — shaded stretches of the track.
  bands = [],
  // (railLengthPx) => [{ key, value, label }]
  ticksFor,
  // (value, handleKey) => value. Per handle, since marks on one rail can snap
  // to different grids.
  snap = (value) => value,
  // (event, handleKey) => keyboard step in axis units.
  stepFor,
  onCommit,
  orientation = "horizontal",
  className,
}) {
  const vertical = orientation === "vertical";
  const [trackRef, trackSize] = useElementSize();
  const draggingRef = useRef(null);
  const railLength = vertical ? trackSize.height : trackSize.width;

  const positionFromPointer = useCallback(
    (event) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return 0;
      const along = vertical
        ? (event.clientY - rect.top) / rect.height
        : (event.clientX - rect.left) / rect.width;
      return Number.isFinite(along) ? Math.min(Math.max(along, 0), 1) : 0;
    },
    [trackRef, vertical],
  );

  const setHandleFromPointer = useCallback(
    (key, event) => {
      onCommit(key, snap(axis.toValue(positionFromPointer(event)), key));
    },
    [axis, positionFromPointer, onCommit, snap],
  );

  function beginDrag(key) {
    return (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.focus();
      draggingRef.current = key;
    };
  }

  function onHandlePointerMove(event) {
    if (!draggingRef.current) return;
    setHandleFromPointer(draggingRef.current, event);
  }

  function endDrag(event) {
    if (!draggingRef.current) return;
    draggingRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  // Closeness in axis position, not units: that's what the eye judges on a
  // warped axis.
  function onTrackPointerDown(event) {
    const pos = positionFromPointer(event);
    const nearest = handles.reduce((best, handle) =>
      Math.abs(axis.toPos(handle.value) - pos) <
      Math.abs(axis.toPos(best.value) - pos)
        ? handle
        : best,
    );
    setHandleFromPointer(nearest.key, event);
  }

  // Both arrow pairs work in either orientation; "up" on a water column means
  // towards the surface.
  function onHandleKeyDown(handle) {
    return (event) => {
      const step = stepFor
        ? stepFor(event, handle.key)
        : (axis.max - axis.min) / 100;
      let next;
      if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) {
        next = handle.value - step;
      } else if (["ArrowRight", "ArrowDown", "PageDown"].includes(event.key)) {
        next = handle.value + step;
      } else if (event.key === "Home") {
        next = axis.min;
      } else if (event.key === "End") {
        next = axis.max;
      } else {
        return;
      }
      event.preventDefault();
      onCommit(
        handle.key,
        snap(Math.min(Math.max(next, axis.min), axis.max), handle.key),
      );
    };
  }

  const ticks = useMemo(
    () => (ticksFor ? ticksFor(railLength) : []),
    [ticksFor, railLength],
  );

  const at = (value) =>
    vertical
      ? { top: `${axis.toPos(value) * 100}%` }
      : { left: `${axis.toPos(value) * 100}%` };
  const span = (from, to) => {
    const start = axis.toPos(from) * 100;
    const length = Math.max(axis.toPos(to) - axis.toPos(from), 0) * 100;
    return vertical
      ? { top: `${start}%`, height: `${length}%` }
      : { left: `${start}%`, width: `${length}%` };
  };

  return (
    <div
      className={["rail", vertical ? "railVertical" : "", className || ""]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        className="railTrack"
        ref={trackRef}
        onPointerDown={onTrackPointerDown}
      >
        <div className="railLine" />
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
            type="button"
            role="slider"
            className={`railHandle ${handle.className}`}
            style={at(handle.value)}
            aria-label={handle.label}
            aria-orientation={vertical ? "vertical" : undefined}
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
      <div className="railTicks" aria-hidden="true">
        {ticks.map(({ key, value, label }) => (
          <span key={key} className="railTick" style={at(value)}>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
