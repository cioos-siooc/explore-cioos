import * as React from "react";
import { useTranslation } from "react-i18next";
import classNames from "classnames";
import { ArrowsExpand, CalendarWeek } from "react-bootstrap-icons";

import polygonImage from "../../Images/polygonIcon.png";
import rectangleImage from "../../Images/rectangleIcon.png";
import { polygonIsRectangle } from "../../../utilities.jsx";
import QuestionIconTooltip from "../QuestionIconTooltip/QuestionIconTooltip.jsx";

/*
 * "Apply this filter to my download" — one chip per filter that is actually
 * doing something, each toggling whether the download narrows by it.
 *
 * Lifted out of DownloadDetails so it sits above the dataset list rather than
 * inside it: both delivery routes below (a queued archive, a URL straight to
 * the source) narrow by these same switches, and there is one set of them
 * because there is one order. It shares the settings band with the link format
 * (DownloadFormats) — one row of chrome, styles in styles.css.
 */
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

  const toggleClassName = (active, enabled) =>
    classNames("filterDownloadToggle", { active }, { disabled: !enabled });

  return (
    <div className="downloadBandGroup filterDownloadToggles">
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
                size={16}
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
                size={16}
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
            >
              <div
                className="mapbox-gl-draw-polygon filterToggleIcon"
                style={{
                  display: "inline",
                  backgroundImage: `url(${
                    polygonIsRectangle(polygon) ? rectangleImage : polygonImage
                  })`,
                  backgroundRepeat: "no-repeat",
                  backgroundSize: "24px 24px",
                  backgroundPositionX: "8px",
                  backgroundPositionY: "-3px",
                  borderRadius: "0px",
                  height: "34px",
                  paddingLeft: "38px",
                }}
              >
                {polygonSummary(polygon)}
              </div>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/*
 * The drawn shape as text. A rectangle is four corners and reads whole; a
 * traced polygon can be dozens, so it shows its first few and its last with an
 * ellipsis between — enough to recognise which shape it is without the chip
 * growing to the width of the panel. The closing point repeats the first and
 * is left off.
 */
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
