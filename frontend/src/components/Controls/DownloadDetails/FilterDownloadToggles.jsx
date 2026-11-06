import * as React from "react";
import { useTranslation } from "react-i18next";
import classNames from "classnames";
import {
  ArrowsExpand,
  BoundingBoxCircles,
  CalendarWeek,
  Pentagon,
} from "react-bootstrap-icons";

import { polygonIsRectangle } from "../../../utilities.jsx";
import QuestionIconTooltip from "../QuestionIconTooltip/QuestionIconTooltip.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { useTips } from "../../../state/tips/TipsProvider.jsx";

export default function FilterDownloadToggles({
  query,
  polygon,
  timeFilterActive,
  filterDownloadByTime,
  setFilterDownloadByTime,
  depthFilterActive,
  filterDownloadByDepth,
  setFilterDownloadByDepth,
  polygonFilterActive,
  filterDownloadByPolygon,
  setFilterDownloadByPolygon,
}) {
  const { t } = useTranslation();
  const { tipHighlight } = useTips();
  const { areaPlace } = useSelection();
  const isRectangle = Boolean(polygon) && polygonIsRectangle(polygon);

  const toggleClassName = (active, enabled) =>
    classNames("filterDownloadToggle", { active }, { disabled: !enabled });

  return (
    <div
      className="downloadBandGroup filterDownloadToggles"
      data-tip-highlight={tipHighlight("filtersCutDownload")}
    >
      <span className="downloadBandLabel">
        {t("downloadDetailsFilterSectionTitle")}
        <QuestionIconTooltip
          tooltipText={t("downloadDetailsFilterQuestionTooltipText")}
          tooltipPlacement={"right"}
          size={16}
        />
      </span>
      <div className="downloadBandContent">
        {!timeFilterActive && !depthFilterActive && !polygonFilterActive && (
          <i className="noFiltersMessage">
            {t("downloadDetailsNoFiltersActiveMessage")}
          </i>
        )}
        {timeFilterActive && (
          <div
            className={toggleClassName(filterDownloadByTime, timeFilterActive)}
          >
            <button
              onClick={() => setFilterDownloadByTime(!filterDownloadByTime)}
              disabled={!timeFilterActive}
            >
              <CalendarWeek
                className="filterToggleIcon"
                size={14}
                aria-hidden="true"
              />
              <span>{`${query.startDate} – ${query.endDate}`}</span>
            </button>
          </div>
        )}
        {depthFilterActive && (
          <div
            className={toggleClassName(
              filterDownloadByDepth,
              depthFilterActive,
            )}
          >
            <button
              onClick={() => setFilterDownloadByDepth(!filterDownloadByDepth)}
              disabled={!depthFilterActive}
            >
              <ArrowsExpand
                className="filterToggleIcon"
                size={14}
                aria-hidden="true"
              />
              <span>{`${query.startDepth} – ${query.endDepth} m`}</span>
            </button>
          </div>
        )}
        {polygonFilterActive && (
          <div
            className={toggleClassName(
              filterDownloadByPolygon,
              polygonFilterActive,
            )}
          >
            <button
              onClick={() =>
                setFilterDownloadByPolygon(!filterDownloadByPolygon)
              }
              disabled={!polygonFilterActive}
              title={polygonSummary(polygon)}
            >
              {isRectangle ? (
                <BoundingBoxCircles
                  className="filterToggleIcon"
                  size={14}
                  aria-hidden="true"
                />
              ) : (
                <Pentagon
                  className="filterToggleIcon"
                  size={14}
                  aria-hidden="true"
                />
              )}
              <span>
                {areaPlace?.name ??
                  t(
                    isRectangle
                      ? "downloadAreaDrawnBox"
                      : "downloadAreaDrawnPolygon",
                  )}
              </span>
            </button>
          </div>
        )}
      </div>
      <p className="downloadVariablesNote">{t("downloadVariablesNote")}</p>
    </div>
  );
}

// A traced polygon shows its first few points and its last; the closing point
// repeats the first and is left off.
function polygonSummary(polygon) {
  if (!polygon) return "";
  const point = (coordinate) =>
    `[${coordinate[0].toFixed(1)}, ${coordinate[1].toFixed(1)}]`;

  return polygon
    .map((coordinate, index) => {
      if (polygon.length >= 6) {
        if (index === polygon.length - 2) return `...${point(coordinate)}`;
        return index <= 3 ? point(coordinate) : "";
      }
      return index < polygon.length - 1 ? point(coordinate) : "";
    })
    .join("");
}
