import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "react-bootstrap-icons";

import {
  trackLineColor,
  tracksMinDate,
  trailingWindowOptions,
} from "../../config.js";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useTips } from "../../../state/tips/TipsProvider.jsx";
import TimeRail, { DateField } from "../TimeRail/TimeRail.jsx";
import {
  MS_PER_DAY,
  clampIso,
  createTimeAxis,
  isoToMs,
  msToIso,
  todayIso,
} from "../TimeRail/timeAxis.js";
import "./styles.css";

// The rail spans the tracks' own domain (tracksMinDate), not the catalogue's:
// at 190px a century of empty axis would leave the Argo era a thumbnail.
export default function TrajectoryDate() {
  const { t } = useTranslation();
  const { scrubTime, setScrubTime, trailingDays, setTrailingDays } =
    useMapState();
  const { tipHighlight } = useTips();

  const maxIso = todayIso();
  const axis = useMemo(() => createTimeAxis(tracksMinDate, maxIso), [maxIso]);
  const value = clampIso(scrubTime, tracksMinDate, maxIso);

  function commit(iso) {
    setScrubTime(clampIso(iso, tracksMinDate, maxIso));
  }

  function stepDay(delta) {
    commit(msToIso(isoToMs(value) + delta * MS_PER_DAY));
  }

  return (
    <div className="trajectoryDate">
      <div className="legendItem trajectoryDateRow">
        <label className="legendItemLabel" htmlFor="trajectoryTrailSelect">
          {t("trajectoryTrailLabel")}
        </label>
        <select
          id="trajectoryTrailSelect"
          className="trajectoryTrailSelect"
          value={trailingDays}
          onChange={(event) => setTrailingDays(Number(event.target.value))}
        >
          {trailingWindowOptions.map((days) => (
            <option key={days} value={days}>
              {days === 365
                ? t("trajectoryTrailOneYear")
                : `${days} ${t("trajectoryTrailDays")}`}
            </option>
          ))}
        </select>
      </div>

      <div
        className="legendItem trajectoryDateRow"
        title={t("legendTrackHead")}
        data-tip-highlight={tipHighlight("trajectory")}
      >
        <svg
          className="legendSwatch"
          width="12"
          height="12"
          viewBox="0 0 16 16"
        >
          <path
            d="M8 1.5 L13.5 13.5 L8 10.5 L2.5 13.5 Z"
            fill={trackLineColor}
            stroke="#ffffff"
            strokeWidth="1.5"
            strokeLinejoin="round"
            transform="rotate(45 8 8)"
          />
        </svg>
        <DateField
          className="railValueInput timeRailDateInput trajectoryDateInput"
          label={t("trajectoryDateLabel")}
          value={value}
          min={tracksMinDate}
          max={maxIso}
          onCommit={commit}
        />
        {/* Chevrons, not filled carets: a filled triangle is the heading
            swatch on this same row. */}
        <button
          type="button"
          className="railStep"
          title={t("trajectoryDatePrevDay")}
          aria-label={t("trajectoryDatePrevDay")}
          disabled={value <= tracksMinDate}
          onClick={() => stepDay(-1)}
        >
          <ChevronLeft size={10} />
        </button>
        <button
          type="button"
          className="railStep"
          title={t("trajectoryDateNextDay")}
          aria-label={t("trajectoryDateNextDay")}
          disabled={value >= maxIso}
          onClick={() => stepDay(1)}
        >
          <ChevronRight size={10} />
        </button>
      </div>

      <TimeRail
        className="trajectoryDateRail"
        axis={axis}
        scrub={{
          value,
          trailStartMs: Math.max(
            isoToMs(value) - trailingDays * MS_PER_DAY,
            axis.minMs,
          ),
        }}
        onCommit={(handle, iso) => commit(iso)}
      />
    </div>
  );
}
