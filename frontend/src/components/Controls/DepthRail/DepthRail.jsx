import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Rail from "../Rail/Rail.jsx";
import {
  createDepthAxis,
  snapToMetre,
  tickDepthsFor,
  MIN_TICK_GAP_PX,
  MIN_TICK_GAP_PX_VERTICAL,
} from "./depthAxis.js";
import { useChanged } from "../../../utilities.jsx";
import "./styles.css";

function keyboardStepMetres(event) {
  if (event.key === "PageUp" || event.key === "PageDown") return 500;
  return event.shiftKey ? 50 : 1;
}

// Not clamped per keystroke (that would rewrite "1" before "1000" is typed);
// see DateField.
export function isCommittable(value, min, max) {
  if (!/^\d{1,5}$/.test(value)) return false;
  const depth = Number(value);
  return depth >= min && depth <= max;
}

export function DepthField({ value, min, max, onCommit, label, className }) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);

  if (useChanged(value, editing) && !editing) setDraft(String(value));

  return (
    <input
      type="number"
      inputMode="numeric"
      className={className || "railValueInput depthRailNumberInput"}
      aria-label={label}
      value={draft}
      min={min}
      max={max}
      onFocus={() => setEditing(true)}
      onChange={(event) => {
        setDraft(event.target.value);
        if (isCommittable(event.target.value, min, max)) {
          onCommit(Number(event.target.value));
        }
      }}
      onBlur={() => {
        setEditing(false);
        if (isCommittable(draft, min, max)) onCommit(Number(draft));
        else setDraft(String(value));
      }}
    />
  );
}

// Places in the water column, not thicknesses, so (unlike time windows)
// dragging one end of a band resizes it.
export const DEPTH_PRESETS = [
  { key: "0-100", start: 0, end: 100, label: "0–100 m" },
  { key: "0-500", start: 0, end: 500, label: "0–500 m" },
  { key: "0-1000", start: 0, end: 1000, label: "0–1000 m" },
  { key: "1000+", start: 1000, end: 12000, label: "1000 m +" },
];

export function matchDepthPreset(startDepth, endDepth, min, max) {
  if (startDepth === min && endDepth === max) return "all";
  const match = DEPTH_PRESETS.find(
    (preset) => preset.start === startDepth && preset.end === endDepth,
  );
  return match ? match.key : "";
}

export function DepthPresetSelect({
  startDepth,
  endDepth,
  min,
  max,
  onSelect,
  className,
  ariaLabel,
}) {
  const { t } = useTranslation();
  const value = matchDepthPreset(startDepth, endDepth, min, max);
  return (
    <select
      className={className}
      aria-label={ariaLabel}
      title={ariaLabel}
      value={value}
      onChange={(event) => {
        const picked = event.target.value;
        if (picked === "all") onSelect(min, max);
        else if (picked) {
          const preset = DEPTH_PRESETS.find((option) => option.key === picked);
          if (preset) onSelect(preset.start, preset.end);
        }
      }}
    >
      {!value && (
        <option value="" disabled>
          {t("depthSelectorPresetLabel")}
        </option>
      )}
      <option value="all">{t("depthSelectorPresetAll")}</option>
      {DEPTH_PRESETS.map(({ key, label }) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </select>
  );
}

// Unlike time there is no /depthExtent, so the axis is the whole filterable
// column.
export function useDepthAxis(min, max) {
  return useMemo(() => createDepthAxis(min, max), [min, max]);
}

export default function DepthRail({
  axis,
  startDepth,
  endDepth,
  onCommit,
  orientation,
  className,
}) {
  const { t } = useTranslation();

  const handles = [
    {
      key: "start",
      value: startDepth,
      valueText: `${startDepth} m`,
      label: t("depthFilterStartDepth"),
      className: "railHandleRange",
    },
    {
      key: "end",
      value: endDepth,
      valueText: `${endDepth} m`,
      label: t("depthFilterEndDepth"),
      className: "railHandleRange",
    },
  ];

  const bands = [
    { key: "range", from: startDepth, to: endDepth, className: "railFill" },
  ];

  const ticksFor = useCallback(
    (railLength) =>
      tickDepthsFor(
        railLength,
        axis.anchorDepths,
        axis.toPos,
        orientation === "vertical" ? MIN_TICK_GAP_PX_VERTICAL : MIN_TICK_GAP_PX,
      ).map((depth) => ({
        key: depth,
        value: depth,
        label: depth,
      })),
    [axis, orientation],
  );

  return (
    <Rail
      className={className}
      orientation={orientation}
      axis={axis}
      handles={handles}
      bands={bands}
      ticksFor={ticksFor}
      snap={snapToMetre}
      stepFor={keyboardStepMetres}
      onCommit={onCommit}
    />
  );
}
