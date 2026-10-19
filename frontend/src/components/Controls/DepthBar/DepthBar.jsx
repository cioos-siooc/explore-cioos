import React, { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { X } from "react-bootstrap-icons";

import { defaultStartDepth, defaultEndDepth } from "../../config.js";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import DepthRail, {
  DepthField,
  useDepthAxis,
} from "../DepthRail/DepthRail.jsx";
import { clampDepth, snapToMetre } from "../DepthRail/depthAxis.js";
import usePublishedFootprint from "../../../state/ui/usePublishedFootprint.js";
import useMediaQuery, {
  MOBILE_QUERY,
} from "../../../state/ui/useMediaQuery.js";
import "./styles.css";

// The narrow-screen legend caps its height against this so it stops short of
// the strip; cleared on unmount.
const DEPTH_BAR_STACK_GAP = 8;
function measureDepthBarSpace(rect) {
  return rect.bottom + DEPTH_BAR_STACK_GAP;
}

// Like TimeBar: only while the filter narrows something, never on phones.
export default function DepthBar() {
  const { depthFilterActive } = useFilters();
  const isMobile = useMediaQuery(MOBILE_QUERY);

  if (!depthFilterActive || isMobile) return null;
  return <DepthBarSurface />;
}

function DepthBarSurface() {
  const { t } = useTranslation();
  const { startDepth, setStartDepth, endDepth, setEndDepth } = useFilters();

  const barRef = useRef(null);
  usePublishedFootprint(
    barRef,
    "--cioos-depth-bar-space",
    measureDepthBarSpace,
  );

  const axis = useDepthAxis(defaultStartDepth, defaultEndDepth);

  const setHandleValue = useCallback(
    (handle, value) => {
      if (handle === "start") {
        setStartDepth(clampDepth(value, defaultStartDepth, endDepth));
      } else {
        setEndDepth(clampDepth(value, startDepth, defaultEndDepth));
      }
    },
    [setStartDepth, setEndDepth, startDepth, endDepth],
  );

  return (
    <div className="depthBar" ref={barRef} aria-label={t("depthBarAriaLabel")}>
      <div className="depthBarLabel">{t("depthRangeFilterName")} (m)</div>

      <div
        className="depthBarTag depthBarTagRange"
        title={t("depthFilterStartDepth")}
      >
        <DepthField
          label={t("depthFilterStartDepth")}
          value={startDepth}
          min={defaultStartDepth}
          max={endDepth}
          onCommit={(value) => setHandleValue("start", value)}
        />
      </div>

      <DepthRail
        className="depthBarRail"
        orientation="vertical"
        axis={axis}
        startDepth={startDepth}
        endDepth={endDepth}
        onCommit={(handle, value) => setHandleValue(handle, snapToMetre(value))}
      />

      <div
        className="depthBarTag depthBarTagRange"
        title={t("depthFilterEndDepth")}
      >
        <DepthField
          label={t("depthFilterEndDepth")}
          value={endDepth}
          min={startDepth}
          max={defaultEndDepth}
          onCommit={(value) => setHandleValue("end", value)}
        />
      </div>

      <button
        type="button"
        className="railReset depthBarReset"
        title={t("depthBarResetRangeTitle")}
        aria-label={t("depthBarResetRangeTitle")}
        onClick={() => {
          setStartDepth(defaultStartDepth);
          setEndDepth(defaultEndDepth);
        }}
      >
        <X size={12} />
      </button>
    </div>
  );
}
