import * as React from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";

import { defaultStartDate } from "../../../config.js";
import { useFilters } from "../../../../state/filters/FilterProvider.jsx";
import TimeRail, {
  DateField,
  IntervalSelect,
  useTimeAxis,
  matchQuickPick,
  slideRange,
} from "../../TimeRail/TimeRail.jsx";
import { clampIso, todayIso } from "../../TimeRail/timeAxis.js";
import "../styles.css";

export default function TimeSelector(props) {
  const { t } = useTranslation();
  const { timeExtent, timeFilterActive } = useFilters();
  const { startDate, endDate, setStartDate, setEndDate } = props;

  const maxIso = todayIso();
  const { axis } = useTimeAxis({
    timeExtent,
    timeFilterActive,
    startDate,
    endDate,
  });

  function setFieldValue(handle, iso) {
    if (handle === "start")
      setStartDate(clampIso(iso, defaultStartDate, endDate));
    else setEndDate(clampIso(iso, startDate, maxIso));
  }

  // Same rule as TimeBar: a quick-pick window drags whole until typing
  // changes its length.
  const windowLocked = !["", "all"].includes(
    matchQuickPick(startDate, endDate, defaultStartDate),
  );

  function setHandleValue(handle, iso) {
    if (!windowLocked) {
      setFieldValue(handle, iso);
      return;
    }
    const { start, end } = slideRange(handle, iso, {
      startDate,
      endDate,
      minIso: defaultStartDate,
      maxIso,
    });
    setStartDate(start);
    setEndDate(end);
  }

  return (
    <div className="filterRangeSelector timeSelector">
      <div className="filterRangeForm">
        <label className="filterRangeRow">
          <span className="filterRangeLabel">{t("timeBarPresetLabel")}</span>
          <IntervalSelect
            className="filterRangeInput filterRangeSelect"
            startDate={startDate}
            endDate={endDate}
            defaultStart={defaultStartDate}
            maxIso={maxIso}
            onSelect={(start, end) => {
              setStartDate(start);
              setEndDate(end);
            }}
          />
        </label>
        <label className="filterRangeRow">
          <span className="filterRangeLabel">{t("timeSelectorStartDate")}</span>
          <DateField
            className="timeRailDateInput filterRangeInput"
            value={startDate}
            min={defaultStartDate}
            max={endDate}
            onCommit={(value) => setFieldValue("start", value)}
          />
        </label>
        <label className="filterRangeRow">
          <span className="filterRangeLabel">{t("timeSelectorEndDate")}</span>
          <DateField
            className="timeRailDateInput filterRangeInput"
            value={endDate}
            min={startDate}
            max={maxIso}
            onCommit={(value) => setFieldValue("end", value)}
          />
        </label>
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

TimeSelector.propTypes = {
  startDate: PropTypes.string.isRequired,
  endDate: PropTypes.string.isRequired,
  setStartDate: PropTypes.func.isRequired,
  setEndDate: PropTypes.func.isRequired,
};
