import React, { useRef } from "react";

import "./paneDividerStyles.css";

// The splitter between two panes: drag it to resize the one it names.
//
// Presentational like Rail.jsx — the width is the caller's state, every change
// goes out through onChange, and the caller does the clamping. The pointer drag
// is the enhancement rather than the control: the arrows, Home/End and a
// double-click to reset all work without one, which is what a role="separator"
// carrying a value promises.
const KEY_STEP_PX = 16;

export default function PaneDivider({
  label,
  value,
  min,
  max,
  reset,
  controls,
  onChange,
  onDragChange = () => {},
}) {
  // Where the drag began and the width it began from, so a pointer that runs
  // past a bound and comes back lands where it points — reporting deltas
  // instead would bank the clamped-away pixels as drift.
  const drag = useRef(null);

  const endDrag = (event) => {
    if (!drag.current) return;
    drag.current = null;
    onDragChange(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown = (event) => {
    if (event.key === "ArrowLeft") onChange(value - KEY_STEP_PX);
    else if (event.key === "ArrowRight") onChange(value + KEY_STEP_PX);
    else if (event.key === "Home") onChange(min);
    else if (event.key === "End") onChange(max);
    else return;
    event.preventDefault();
  };

  return (
    <div
      className="paneDivider"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-controls={controls}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        drag.current = { x: event.clientX, from: value };
        onDragChange(true);
        // Deliberately no preventDefault, unlike Rail: the compatibility
        // mousedown is what ui/Dropdown closes an open menu on, and a menu left
        // open would hang over the plot at the position it was measured at
        // before the drag. setPointerCapture is optional-called because jsdom
        // does not implement it at all.
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        onChange(drag.current.from + (event.clientX - drag.current.x));
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={() => onChange(reset)}
      onKeyDown={onKeyDown}
    />
  );
}
