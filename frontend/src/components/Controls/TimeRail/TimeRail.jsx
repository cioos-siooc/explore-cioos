import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { defaultStartDate } from "../../config.js";
import Rail from "../Rail/Rail.jsx";
import {
  MS_PER_DAY,
  createTimeAxis,
  isoToMs,
  msToIso,
  snapToDay,
  clampIso,
  todayIso,
  tickYearsFor,
} from "./timeAxis.js";
import { useChanged } from "../../../utilities.jsx";
import "./styles.css";

function keyboardStepDays(event) {
  if (event.key === "PageUp" || event.key === "PageDown") return 365;
  return event.shiftKey ? 30 : 1;
}

// `type=date` fires per keystroke ("2015" arrives as 0002, 0020, 0201), so
// clamping each one would overwrite the typing; partial values are held
// locally and only complete, in-range dates commit.
export function isCommittable(value, min, max) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) return false;
  return (!min || value >= min) && (!max || value <= max);
}

export function DateField({ value, min, max, onCommit, label, className }) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);

  if (useChanged(value, editing) && !editing) setDraft(value);

  return (
    <input
      type="date"
      className={className || "railValueInput timeRailDateInput"}
      aria-label={label}
      value={draft}
      min={min}
      max={max}
      onFocus={() => setEditing(true)}
      onChange={(event) => {
        setDraft(event.target.value);
        if (isCommittable(event.target.value, min, max)) {
          onCommit(event.target.value);
        }
      }}
      onBlur={() => {
        setEditing(false);
        if (isCommittable(draft, min, max)) onCommit(draft);
        else setDraft(value);
      }}
    />
  );
}

export const QUICK_PICKS = [
  { days: 10, labelKey: "timeSelectorQuickSelect10Days" },
  { days: 30, labelKey: "timeSelectorQuickSelect30Days" },
  { days: 365, labelKey: "timeSelectorQuickSelect1Year" },
  { days: 3652, labelKey: "timeSelectorQuickSelect10Years" },
];

export function lastDaysRange(days) {
  const end = todayIso();
  const start = msToIso(isoToMs(end) - days * MS_PER_DAY);
  return { start, end };
}

// Matched on length, not position, so dragging a chosen window doesn't
// unselect it.
export function matchQuickPick(startDate, endDate, defaultStart) {
  if (startDate === defaultStart && endDate === todayIso()) return "all";
  const days = Math.round((isoToMs(endDate) - isoToMs(startDate)) / MS_PER_DAY);
  return QUICK_PICKS.some((pick) => pick.days === days) ? String(days) : "";
}

export function slideRange(
  handle,
  iso,
  { startDate, endDate, minIso, maxIso },
) {
  const spanMs = isoToMs(endDate) - isoToMs(startDate);
  const minMs = isoToMs(minIso);
  const maxMs = isoToMs(maxIso);
  if (maxMs - minMs <= spanMs) return { start: minIso, end: maxIso };
  const wantedMs = handle === "start" ? isoToMs(iso) : isoToMs(iso) - spanMs;
  const startMs = Math.min(Math.max(wantedMs, minMs), maxMs - spanMs);
  return { start: msToIso(startMs), end: msToIso(startMs + spanMs) };
}

export function IntervalSelect({
  startDate,
  endDate,
  defaultStart,
  maxIso,
  onSelect,
  className,
  // Only over the map; in the Filters panel the form's own label names it.
  ariaLabel,
}) {
  const { t } = useTranslation();
  const value = matchQuickPick(startDate, endDate, defaultStart);
  return (
    <select
      className={className}
      aria-label={ariaLabel}
      title={ariaLabel}
      value={value}
      onChange={(event) => {
        const picked = event.target.value;
        if (picked === "all") onSelect(defaultStart, maxIso);
        else if (picked) {
          const { start, end } = lastDaysRange(Number(picked));
          onSelect(start, end);
        }
      }}
    >
      {!value && (
        <option value="" disabled>
          {t("timeBarPresetLabel")}
        </option>
      )}
      <option value="all">{t("timeBarPresetAll")}</option>
      {QUICK_PICKS.map(({ days, labelKey }) => (
        <option key={days} value={days}>
          {t(labelKey)}
        </option>
      ))}
    </select>
  );
}

// The axis shrinks to the data's extent. An active filter reaching past it
// widens it back, since a handle off the axis can't be dragged back; the
// default range means "unbounded" and doesn't.
export function useTimeAxis({
  timeExtent,
  timeFilterActive,
  startDate,
  endDate,
}) {
  const maxIso = todayIso();
  const dataStart = clampIso(
    timeExtent?.min?.split("T")[0] || defaultStartDate,
    defaultStartDate,
    maxIso,
  );
  const dataEnd = clampIso(
    timeExtent?.max?.split("T")[0] || maxIso,
    dataStart,
    maxIso,
  );
  const domainStart =
    timeFilterActive && startDate < dataStart ? startDate : dataStart;
  const domainEnd = [dataEnd, timeFilterActive ? endDate : ""]
    .filter(Boolean)
    .reduce((latest, date) => (date > latest ? date : latest));

  const axis = useMemo(
    () => createTimeAxis(domainStart, domainEnd),
    [domainStart, domainEnd],
  );
  return { axis, maxIso, domainStart, domainEnd };
}

export default function TimeRail({
  axis,
  // Both or neither.
  startDate,
  endDate,
  // { value, trailStartMs }, only on the trajectory-date rail.
  scrub,
  onCommit,
  className,
}) {
  const { t } = useTranslation();

  const railAxis = useMemo(
    () => ({
      min: axis.minMs,
      max: axis.maxMs,
      minText: axis.minIso,
      maxText: axis.maxIso,
      toPos: axis.toPos,
      toValue: axis.toMs,
    }),
    [axis],
  );

  const range = Boolean(startDate && endDate);

  const handles = [
    ...(range
      ? [
          {
            key: "start",
            value: isoToMs(startDate),
            valueText: startDate,
            label: t("timeBarRangeStartHandle"),
            className: "railHandleRange",
          },
          {
            key: "end",
            value: isoToMs(endDate),
            valueText: endDate,
            label: t("timeBarRangeEndHandle"),
            className: "railHandleRange",
          },
        ]
      : []),
    ...(scrub
      ? [
          {
            key: "scrub",
            value: isoToMs(scrub.value),
            valueText: scrub.value,
            label: t("trajectoryDateLabel"),
            className: "railHandleMarker timeRailHandleScrub",
          },
        ]
      : []),
  ];

  const bands = [
    ...(range
      ? [
          {
            key: "range",
            from: isoToMs(startDate),
            to: isoToMs(endDate),
            className: "railFill",
          },
        ]
      : []),
    ...(scrub
      ? [
          {
            key: "trail",
            from: scrub.trailStartMs,
            to: isoToMs(scrub.value),
            className: "timeRailTrailBand",
            title: t("trajectoryTrailBandTitle"),
          },
        ]
      : []),
  ];

  const ticksFor = useCallback(
    (railWidth) =>
      tickYearsFor(railWidth, axis.anchorYears, axis.toPos).map((year) => ({
        key: year,
        value: isoToMs(`${year}-01-01`),
        label: year,
      })),
    [axis],
  );

  return (
    <Rail
      className={className}
      axis={railAxis}
      handles={handles}
      bands={bands}
      ticksFor={ticksFor}
      snap={snapToDay}
      stepFor={(event) => keyboardStepDays(event) * MS_PER_DAY}
      onCommit={(handle, ms) => onCommit(handle, msToIso(ms))}
    />
  );
}
