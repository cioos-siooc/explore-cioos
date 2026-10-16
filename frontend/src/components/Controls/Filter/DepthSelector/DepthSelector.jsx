import * as React from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";

import { defaultStartDepth, defaultEndDepth } from "../../../config.js";
import DepthRail, {
  DepthField,
  DepthPresetSelect,
  useDepthAxis,
} from "../../DepthRail/DepthRail.jsx";
import { clampDepth } from "../../DepthRail/depthAxis.js";
import "../styles.css";

export default function DepthSelector(props) {
  const { t } = useTranslation();
  const { startDepth, endDepth, setStartDepth, setEndDepth } = props;

  const axis = useDepthAxis(defaultStartDepth, defaultEndDepth);

  function setHandleValue(handle, value) {
    if (handle === "start") {
      setStartDepth(clampDepth(value, defaultStartDepth, endDepth));
    } else {
      setEndDepth(clampDepth(value, startDepth, defaultEndDepth));
    }
  }

  return (
    <div className="filterRangeSelector depthSelector">
      <div className="filterRangeForm">
        <label className="filterRangeRow">
          <span className="filterRangeLabel">
            {t("depthSelectorPresetLabel")}
          </span>
          <DepthPresetSelect
            className="filterRangeInput filterRangeSelect"
            startDepth={startDepth}
            endDepth={endDepth}
            min={defaultStartDepth}
            max={defaultEndDepth}
            onSelect={(start, end) => {
              setStartDepth(start);
              setEndDepth(end);
            }}
          />
        </label>
        <label className="filterRangeRow">
          <span className="filterRangeLabel">{t("depthFilterStartDepth")}</span>
          <DepthField
            className="filterRangeInput"
            value={startDepth}
            min={defaultStartDepth}
            max={endDepth}
            onCommit={(value) => setHandleValue("start", value)}
          />
        </label>
        <label className="filterRangeRow">
          <span className="filterRangeLabel">{t("depthFilterEndDepth")}</span>
          <DepthField
            className="filterRangeInput"
            value={endDepth}
            min={startDepth}
            max={defaultEndDepth}
            onCommit={(value) => setHandleValue("end", value)}
          />
        </label>
      </div>
      <DepthRail
        axis={axis}
        startDepth={startDepth}
        endDepth={endDepth}
        onCommit={setHandleValue}
      />
    </div>
  );
}

DepthSelector.propTypes = {
  startDepth: PropTypes.number.isRequired,
  endDepth: PropTypes.number.isRequired,
  setStartDepth: PropTypes.func.isRequired,
  setEndDepth: PropTypes.func.isRequired,
};
