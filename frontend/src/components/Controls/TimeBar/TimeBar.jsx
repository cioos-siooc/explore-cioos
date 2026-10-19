import React, { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { X } from "react-bootstrap-icons";

import { defaultStartDate } from "../../config.js";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import { useTips } from "../../../state/tips/TipsProvider.jsx";
import TimeRail, {
  DateField,
  IntervalSelect,
  useTimeAxis,
  matchQuickPick,
  slideRange,
} from "../TimeRail/TimeRail.jsx";
import { clampIso } from "../TimeRail/timeAxis.js";
import usePublishedFootprint from "../../../state/ui/usePublishedFootprint.js";
import useMediaQuery, {
  MOBILE_QUERY,
} from "../../../state/ui/useMediaQuery.js";
import "./styles.css";

// Other overlays on the lower map take their clearance from this, since the
// bar's height varies with locale label lengths.
function measureBarSpace({ top, height }) {
  return Math.max(window.innerHeight - top, height);
}

// Only mounted while the filter narrows something, to save map room; never on
// phones, where a finger-wide axis can't pick a date (Filters panel instead).
export default function TimeBar() {
  const { timeFilterActive } = useFilters();
  const isMobile = useMediaQuery(MOBILE_QUERY);

  if (!timeFilterActive || isMobile) return null;
  return <TimeBarSurface />;
}

// Split out so the published footprint is cleared on unmount.
function TimeBarSurface() {
  const { t } = useTranslation();
  const {
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    timeFilterActive,
    timeExtent,
  } = useFilters();

  const { offerTip } = useTips();
  useEffect(() => offerTip("timeCoverage"), [offerTip]);
  const barRef = useRef(null);
  usePublishedFootprint(barRef, "--cioos-time-bar-space", measureBarSpace);

  const { axis, maxIso } = useTimeAxis({
    timeExtent,
    timeFilterActive,
    startDate,
    endDate,
  });

  // Dragging either end of a quick-pick window moves it whole; typing a date
  // changes its length, which releases the lock.
  const windowLocked = !["", "all"].includes(
    matchQuickPick(startDate, endDate, defaultStartDate),
  );

  // Bounded by the filter's legal domain, not the drawn axis: a typed date may
  // reach past the data and widen the axis.
  const setFieldValue = useCallback(
    (handle, iso) => {
      if (handle === "start") {
        setStartDate(clampIso(iso, defaultStartDate, endDate));
      } else setEndDate(clampIso(iso, startDate, maxIso));
    },
    [setStartDate, setEndDate, startDate, endDate, maxIso],
  );

  const setHandleValue = useCallback(
    (handle, iso) => {
      if (!windowLocked) return setFieldValue(handle, iso);
      const { start, end } = slideRange(handle, iso, {
        startDate,
        endDate,
        minIso: defaultStartDate,
        maxIso,
      });
      setStartDate(start);
      setEndDate(end);
    },
    [
      setFieldValue,
      setStartDate,
      setEndDate,
      windowLocked,
      startDate,
      endDate,
      maxIso,
    ],
  );

  return (
    <div className="timeBar" ref={barRef} aria-label={t("timeBarAriaLabel")}>
      <div className="timeBarFields" role="group">
        <span className="railFieldLabel">{t("timeBarRangeLabel")}</span>
        <DateField
          label={t("timeSelectorStartDate")}
          value={startDate}
          min={defaultStartDate}
          max={endDate}
          onCommit={(value) => setFieldValue("start", value)}
        />
        <span className="railFieldSep">–</span>
        <DateField
          label={t("timeSelectorEndDate")}
          value={endDate}
          min={startDate}
          max={maxIso}
          onCommit={(value) => setFieldValue("end", value)}
        />
        <IntervalSelect
          className="railPresetSelect"
          ariaLabel={t("timeBarPresetLabel")}
          startDate={startDate}
          endDate={endDate}
          defaultStart={defaultStartDate}
          maxIso={maxIso}
          onSelect={(start, end) => {
            setStartDate(start);
            setEndDate(end);
          }}
        />
        <button
          type="button"
          className="railReset"
          title={t("timeBarResetRangeTitle")}
          aria-label={t("timeBarResetRangeTitle")}
          onClick={() => {
            setStartDate(defaultStartDate);
            setEndDate(maxIso);
          }}
        >
          <X size={14} />
        </button>
      </div>
      <TimeRail
        axis={axis}
        startDate={startDate}
        endDate={endDate}
        onCommit={setHandleValue}
      />
    </div>
  );
}
