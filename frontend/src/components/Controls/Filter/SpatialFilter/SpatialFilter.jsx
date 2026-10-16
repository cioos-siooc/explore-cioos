import * as React from "react";
import { useEffect, useState } from "react";
import {
  BoundingBox,
  Check2,
  BoxArrowUpRight,
  Clipboard,
  GeoAlt,
  Pentagon,
} from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";

import {
  polygonBounds,
  polygonIsRectangle,
  polygonToWkt,
} from "../../../../utilities.jsx";
import { useMapState } from "../../../../state/map/MapStateProvider.jsx";
import {
  regionRecordUrl,
  regionDescription,
} from "../../../../state/regionSearch.js";
import { useSelection } from "../../../../state/selection/SelectionProvider.jsx";
import { useUI } from "../../../../state/ui/UIProvider.jsx";
import {
  useGoToRegion,
  useRegionMatches,
} from "../../../../state/useRegionSearch.js";
import Spinner from "../../../ui/Spinner.jsx";
import "../MultiCheckboxFilter/styles.css";
import "./styles.css";

// An area becomes the area filter as its outline or its box, and any place can
// just be gone to. Picking closes the modal so the map is in view.
function PlaceSearch() {
  const { t } = useTranslation();
  const { setShowFiltersModal } = useUI();
  const goTo = useGoToRegion();
  const [term, setTerm] = useState("");
  const { places, loading } = useRegionMatches(term.trim());

  const pick = (place, shape) => {
    setShowFiltersModal(false);
    goTo(place, shape);
  };
  const shapes = [
    { id: "polygon", Icon: Pentagon, label: t("drawPolygonOption") },
    { id: "box", Icon: BoundingBox, label: t("drawBoundingBoxOption") },
  ];

  return (
    <div className="spatialFilterPlaces">
      <label className="spatialFilterPlacesLabel">
        {t("spatialFilterPlaceLabel")}
        <input
          className="filterSearch"
          type="text"
          data-testid="spatial-filter-place-input"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={t("spatialFilterPlacePlaceholder")}
        />
      </label>
      <ul className="spatialFilterPlaceList" aria-live="polite">
        {places.map((place) => (
          <li key={place.id} className="spatialFilterPlace">
            <span className="spatialFilterPlaceText">
              <span className="spatialFilterPlaceName">
                {place.name}
                {place.otherNames.length > 0 && (
                  <span className="spatialFilterPlaceOtherNames">
                    {" · "}
                    {place.otherNames.join(" · ")}
                  </span>
                )}
              </span>
              <span className="spatialFilterPlaceType">
                {regionDescription(place, t)}
              </span>
            </span>
            {place.area &&
              shapes.map(({ id, Icon, label }) => (
                <button
                  key={id}
                  type="button"
                  className="spatialFilterPlaceAction"
                  data-testid={`spatial-filter-place-${id}`}
                  onClick={() => pick(place, id)}
                  aria-label={`${t("regionSearchAction", { shape: label })}: ${place.name}`}
                >
                  <Icon size={14} aria-hidden="true" />
                  {label}
                </button>
              ))}
            <button
              type="button"
              className="spatialFilterPlaceAction"
              onClick={() => pick(place, "goto")}
              title={t("regionSearchGoTo")}
              aria-label={`${t("regionSearchGoTo")}: ${place.name}`}
            >
              <GeoAlt size={14} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {loading && (
        <div role="status" className="spatialFilterPlacesLoading">
          <Spinner size="sm" role={null} />
          {t("regionSearchLoading")}
        </div>
      )}
      <p className="spatialFilterPlacesSource">
        {t("spatialFilterPlaceSource")}
      </p>
    </div>
  );
}

// Unlike SpatialFilterButton this doesn't auto-arm the last tool on open:
// opening this pane is browsing, not the start of drawing.
export default function SpatialFilter() {
  const { t, i18n } = useTranslation();
  const { requestDraw } = useMapState();
  const { polygon, areaPlace } = useSelection();
  const { setShowFiltersModal } = useUI();

  const [wktCopied, setWktCopied] = useState(false);
  useEffect(() => {
    if (!wktCopied) return;
    const timer = setTimeout(() => setWktCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [wktCopied]);

  const hasSelection = Boolean(polygon);
  const activeMode = hasSelection
    ? polygonIsRectangle(polygon)
      ? "box"
      : "polygon"
    : undefined;
  const bounds = hasSelection ? polygonBounds(polygon) : undefined;
  const wkt = hasSelection ? polygonToWkt(polygon) : "";

  function startDraw(mode) {
    setShowFiltersModal(false);
    requestDraw(mode);
  }

  return (
    <div className="spatialFilterOptions">
      <div className="multiCheckboxFilter">
        <div
          className={`optionButton ${activeMode === "box" ? "selected" : ""}`}
          onClick={() => startDraw("box")}
        >
          <BoundingBox />
          <span className="optionName">{t("drawBoundingBoxOption")}</span>
        </div>
        <div
          className={`optionButton ${activeMode === "polygon" ? "selected" : ""}`}
          onClick={() => startDraw("polygon")}
        >
          <Pentagon />
          <span className="optionName">{t("drawPolygonOption")}</span>
        </div>
      </div>
      <PlaceSearch />
      {hasSelection && (
        <div className="spatialFilterDetails">
          {areaPlace && (
            <p className="spatialFilterPlaceApplied">
              <span className="spatialFilterPlaceAppliedName">
                {areaPlace.name}
              </span>
              <a
                href={regionRecordUrl(
                  areaPlace.cgndbid,
                  i18n.language?.startsWith("fr") ? "fr" : "en",
                )}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="spatial-filter-place-record"
              >
                {t("spatialFilterPlaceRecord")}
                <BoxArrowUpRight size={12} aria-hidden="true" />
              </a>
            </p>
          )}
          <dl className="spatialFilterBounds">
            <div className="spatialFilterBoundsNorth">
              <dt>{t("spatialFilterNorth")}</dt>
              <dd>{bounds.north.toFixed(4)}</dd>
            </div>
            <div className="spatialFilterBoundsWest">
              <dt>{t("spatialFilterWest")}</dt>
              <dd>{bounds.west.toFixed(4)}</dd>
            </div>
            <div className="spatialFilterBoundsEast">
              <dt>{t("spatialFilterEast")}</dt>
              <dd>{bounds.east.toFixed(4)}</dd>
            </div>
            <div className="spatialFilterBoundsSouth">
              <dt>{t("spatialFilterSouth")}</dt>
              <dd>{bounds.south.toFixed(4)}</dd>
            </div>
          </dl>
          <label className="spatialFilterWktLabel">
            WKT
            <textarea
              className="spatialFilterWkt"
              readOnly
              value={wkt}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <button
            type="button"
            className="spatialFilterCopyWkt"
            onClick={() => {
              navigator.clipboard.writeText(wkt);
              setWktCopied(true);
            }}
          >
            {wktCopied ? (
              <Check2 size={14} aria-hidden="true" />
            ) : (
              <Clipboard size={14} aria-hidden="true" />
            )}
            {t(wktCopied ? "copiedSelectionWktTitle" : "copySelectionWktTitle")}
          </button>
        </div>
      )}
    </div>
  );
}
