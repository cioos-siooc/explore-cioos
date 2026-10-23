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
  areaFromBounds,
  parseArea,
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
  useApplyArea,
  useGoToRegion,
  useRegionMatches,
} from "../../../../state/useRegionSearch.js";
import Spinner from "../../../ui/Spinner.jsx";
import "../MultiCheckboxFilter/styles.css";
import "./styles.css";

// An area becomes the area filter as its outline or its box, and any place can
// just be gone to. Picking closes the modal so the map is in view.
function PlaceSearch({ children }) {
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
    <section>
      <label className="spatialFilterPlacesLabel">
        <span className="spatialFilterSectionTitle">
          {t("spatialFilterPlaceLabel")}
        </span>
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
            {place.area ? (
              <Pentagon
                className="spatialFilterPlaceKind"
                size={14}
                data-testid="spatial-filter-place-area"
                aria-hidden="true"
              />
            ) : (
              <GeoAlt
                className="spatialFilterPlaceKind"
                size={14}
                data-testid="spatial-filter-place-point"
                aria-hidden="true"
              />
            )}
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
      {children}
    </section>
  );
}

const SIDES = ["north", "west", "east", "south"];
const SIDE_LABELS = {
  north: "spatialFilterNorth",
  west: "spatialFilterWest",
  east: "spatialFilterEast",
  south: "spatialFilterSouth",
};

// The area as numbers to edit: its bounds, as a box, and its outline as WKT,
// which also takes a pasted box. Keyed on the area by its caller, so a new
// drawing replaces whatever was being typed. Applying closes the modal so the
// map is in view.
function AreaEditor({ polygon }) {
  const { t } = useTranslation();
  const { setShowFiltersModal } = useUI();
  const applyArea = useApplyArea();
  const [bounds, setBounds] = useState(() => {
    const current = polygon && polygonBounds(polygon);
    return Object.fromEntries(
      SIDES.map((side) => [side, current ? current[side].toFixed(4) : ""]),
    );
  });
  const [wkt, setWkt] = useState(() => (polygon ? polygonToWkt(polygon) : ""));
  const [invalid, setInvalid] = useState();

  const [wktCopied, setWktCopied] = useState(false);
  useEffect(() => {
    if (!wktCopied) return;
    const timer = setTimeout(() => setWktCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [wktCopied]);

  function apply(event, which, ring) {
    event.preventDefault();
    if (!ring) {
      setInvalid(which);
      return;
    }
    setShowFiltersModal(false);
    applyArea(ring);
  }

  return (
    <>
      <form
        className="spatialFilterBoundsForm"
        noValidate
        onSubmit={(e) =>
          apply(
            e,
            "bounds",
            areaFromBounds(
              Object.fromEntries(
                SIDES.map((side) => [side, Number.parseFloat(bounds[side])]),
              ),
            ),
          )
        }
      >
        <div className="spatialFilterBounds">
          {SIDES.map((side) => (
            <label
              key={side}
              className={`spatialFilterBounds${side[0].toUpperCase()}${side.slice(1)}`}
            >
              {t(SIDE_LABELS[side])}
              <input
                type="number"
                step="any"
                inputMode="decimal"
                data-testid={`spatial-filter-${side}`}
                value={bounds[side]}
                aria-invalid={invalid === "bounds"}
                aria-describedby={
                  invalid === "bounds"
                    ? "spatial-filter-bounds-error"
                    : undefined
                }
                onChange={(e) => {
                  setInvalid(undefined);
                  setBounds((prev) => ({ ...prev, [side]: e.target.value }));
                }}
              />
            </label>
          ))}
        </div>
        {invalid === "bounds" && (
          <p
            id="spatial-filter-bounds-error"
            className="spatialFilterError"
            role="alert"
          >
            {t("spatialFilterBoundsInvalid")}
          </p>
        )}
        <div className="spatialFilterActions">
          <button
            type="submit"
            className="spatialFilterAction spatialFilterApply"
          >
            <BoundingBox size={14} aria-hidden="true" />
            {t("spatialFilterApplyBox")}
          </button>
        </div>
      </form>
      <form
        className="spatialFilterWktForm"
        noValidate
        onSubmit={(e) => apply(e, "wkt", parseArea(wkt))}
      >
        <label className="spatialFilterWktLabel">
          {t("spatialFilterWktLabel")}
          <textarea
            className="spatialFilterWkt"
            data-testid="spatial-filter-wkt"
            value={wkt}
            placeholder="POLYGON((-67 44, -64 44, -64 46, -67 44))"
            aria-invalid={invalid === "wkt"}
            aria-describedby={
              invalid === "wkt" ? "spatial-filter-wkt-error" : undefined
            }
            onChange={(e) => {
              setInvalid(undefined);
              setWkt(e.target.value);
            }}
          />
        </label>
        {invalid === "wkt" && (
          <p
            id="spatial-filter-wkt-error"
            className="spatialFilterError"
            role="alert"
          >
            {t("spatialFilterWktInvalid")}
          </p>
        )}
        <div className="spatialFilterActions">
          {polygon && (
            <button
              type="button"
              className="spatialFilterAction"
              onClick={() => {
                navigator.clipboard.writeText(polygonToWkt(polygon));
                setWktCopied(true);
              }}
            >
              {wktCopied ? (
                <Check2 size={14} aria-hidden="true" />
              ) : (
                <Clipboard size={14} aria-hidden="true" />
              )}
              {t(
                wktCopied ? "copiedSelectionWktTitle" : "copySelectionWktTitle",
              )}
            </button>
          )}
          <button
            type="submit"
            className="spatialFilterAction spatialFilterApply"
          >
            <Pentagon size={14} aria-hidden="true" />
            {t("spatialFilterApplyWkt")}
          </button>
        </div>
      </form>
    </>
  );
}

// Unlike SpatialFilterButton this doesn't auto-arm the last tool on open:
// opening this pane is browsing, not the start of drawing.
export default function SpatialFilter() {
  const { t, i18n } = useTranslation();
  const { requestDraw } = useMapState();
  const { polygon, areaPlace } = useSelection();
  const { setShowFiltersModal } = useUI();

  const activeMode = polygon
    ? polygonIsRectangle(polygon)
      ? "box"
      : "polygon"
    : undefined;

  function startDraw(mode) {
    setShowFiltersModal(false);
    requestDraw(mode);
  }

  return (
    <div className="spatialFilterOptions">
      <section>
        <h3 className="spatialFilterSectionTitle">
          {t("spatialFilterDrawTitle")}
        </h3>
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
      </section>
      <PlaceSearch>
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
      </PlaceSearch>
      <section>
        <h3 className="spatialFilterSectionTitle">
          {t("spatialFilterCoordinatesTitle")}
        </h3>
        <AreaEditor
          key={polygon ? polygonToWkt(polygon) : "none"}
          polygon={polygon}
        />
      </section>
    </div>
  );
}
