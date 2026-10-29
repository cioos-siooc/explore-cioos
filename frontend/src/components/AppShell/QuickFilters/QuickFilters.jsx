import * as React from "react";
import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowCounterclockwise,
  BoundingBox,
  BroadcastPin,
  Database,
  Eye,
  Pentagon,
  Trash,
  ZoomIn,
} from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import { AREA_CAMERA, polygonIsRectangle } from "../../../utilities.jsx";
import { isMarkerTier } from "../../config.js";
import useDatasetCounts from "../../../state/useDatasetCounts.js";
import useResetAllFilters from "../../../state/useResetAllFilters.js";
import { useTips } from "../../../state/tips/TipsProvider.jsx";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import {
  useMapState,
  useMapView,
} from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { useSourceMode } from "../../../state/useSourceKinds.js";
import "./styles.css";

const SOURCE_CAPTION = {
  all: "quickFilterCaptionSource",
  erddap: "quickFilterSourceErddap",
  obis: "quickFilterSourceObis",
  custom: "quickFilterCaptionSource",
};
const SOURCE_LABEL = {
  ...SOURCE_CAPTION,
  all: "quickFilterSourceAll",
  custom: "quickFilterSourceCustom",
};
const SOURCE_NEXT_TITLE = {
  all: "quickFilterSourceNextErddap",
  erddap: "quickFilterSourceNextObis",
  obis: "quickFilterSourceNextAll",
  custom: "quickFilterSourceNextAll",
};

// drawRequest is a *last* request, not a current one (see MapStateProvider),
// so the lit menu item comes from the drawn shape, or failing one from the tool
// this menu armed. Captions because a touch screen has no hover to show the
// title.
export default function QuickFilters() {
  const { t, i18n } = useTranslation();
  const { requestDraw, zoomToGeometry } = useMapState();
  const { zoom } = useMapView();
  const {
    polygon,
    areaPlace,
    onlyInView,
    setOnlyInView,
    inViewCount,
    realtimeCount,
  } = useSelection();
  const { ready: countsReady } = useDatasetCounts();
  const { realtimeOnly, setRealtimeOnly } = useFilters();
  const { offerTip, tipHighlight } = useTips();
  const [canReset, resetAll] = useResetAllFilters();
  const {
    available: sourceAvailable,
    mode: sourceMode,
    cycle: cycleSource,
  } = useSourceMode();
  const zoomedIn = isMarkerTier(zoom) && !onlyInView;
  useEffect(() => {
    if (zoomedIn) offerTip("inView");
  }, [zoomedIn, offerTip]);

  const areaMenuId = useId();
  const inViewCountId = useId();
  const realtimeCountId = useId();
  const areaRef = useRef(null);
  const areaButtonRef = useRef(null);
  const [areaMenuOpen, setAreaMenuOpen] = useState(false);
  const [armedMode, setArmedMode] = useState(null);

  // Pointer, not only blur: Safari never focuses a clicked button.
  useEffect(() => {
    if (!areaMenuOpen) return;
    function onPointerDown(e) {
      if (!areaRef.current?.contains(e.target)) setAreaMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [areaMenuOpen]);

  const hasShape = Boolean(polygon);
  const boxDrawn = hasShape && polygonIsRectangle(polygon);
  const polygonDrawn = hasShape && !boxDrawn;
  const boxActive = boxDrawn || (!hasShape && armedMode === "box");
  const polygonActive = polygonDrawn || (!hasShape && armedMode === "polygon");

  // Not shown before the counts land, so it never flashes a zero.
  function compactCount(applied, count) {
    if (applied || !countsReady) return null;
    return count.toLocaleString(i18n.language, {
      notation: "compact",
      maximumFractionDigits: 1,
    });
  }

  // WCAG 2.5.3: the name has to contain the visible count too.
  function countedLabel(applied, count, caption) {
    const shown = compactCount(applied, count);
    return shown ? `${shown} ${caption}` : caption;
  }

  // The space keeps the count and the caption separate words for axe; a flex
  // container doesn't render it.
  function countPreview(applied, count, id, testId) {
    const shown = compactCount(applied, count);
    if (!shown) return null;
    return (
      <>
        <span className="quickFilterCount" data-testid={testId}>
          {shown}
        </span>{" "}
        <span id={id} className="sr-only">
          {t("quickFilterCountDescription", { count })}
        </span>
      </>
    );
  }

  function chooseArea(mode) {
    requestDraw(mode);
    setArmedMode(mode === "clear" ? null : mode);
    setAreaMenuOpen(false);
    areaButtonRef.current?.focus();
  }

  // Opening arms the box tool so one click starts drawing; arming wipes the
  // drawn shape, so not when there is one.
  function openAreaMenu() {
    setAreaMenuOpen(true);
    if (hasShape) return;
    requestDraw("box");
    setArmedMode("box");
  }

  // A click elsewhere closes the menu without disarming: it is usually the
  // first corner of the box.
  function dismissAreaMenu() {
    setAreaMenuOpen(false);
    areaButtonRef.current?.focus();
    if (hasShape || !armedMode) return;
    requestDraw("clear");
    setArmedMode(null);
  }

  return (
    <div
      className="quickFilters"
      role="group"
      aria-label={t("topBarQuickFiltersLabel")}
      data-testid="quick-filters"
    >
      <div
        ref={areaRef}
        className={classNames("quickFilterArea", { open: areaMenuOpen })}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget))
            setAreaMenuOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && areaMenuOpen) dismissAreaMenu();
        }}
      >
        <button
          ref={areaButtonRef}
          type="button"
          className={classNames("quickFilterButton", { applied: hasShape })}
          data-testid="quick-filter-area"
          onClick={areaMenuOpen ? dismissAreaMenu : openAreaMenu}
          aria-expanded={areaMenuOpen}
          aria-controls={areaMenuOpen ? areaMenuId : undefined}
          title={
            areaPlace
              ? `${t("spatialFilterFilterName")}: ${areaPlace.name}`
              : t("quickFilterAreaTitle")
          }
          aria-label={
            areaPlace
              ? `${t("quickFilterCaptionArea")}: ${areaPlace.name}`
              : t("quickFilterCaptionArea")
          }
        >
          {polygonDrawn ? (
            <Pentagon size={18} aria-hidden="true" />
          ) : (
            <BoundingBox size={18} aria-hidden="true" />
          )}
          <span className="quickFilterCaption" aria-hidden="true">
            {t("quickFilterCaptionArea")}
          </span>
        </button>
        {areaMenuOpen && (
          <div
            id={areaMenuId}
            className="quickFilterAreaMenu"
            data-testid="quick-filter-area-menu"
          >
            <button
              type="button"
              className={classNames("quickFilterAreaItem", {
                selected: boxActive,
              })}
              data-testid="quick-filter-area-box"
              onClick={() => chooseArea("box")}
              aria-pressed={boxActive}
            >
              <BoundingBox size={16} aria-hidden="true" />
              {t("drawBoundingBoxOption")}
            </button>
            <button
              type="button"
              className={classNames("quickFilterAreaItem", {
                selected: polygonActive,
              })}
              data-testid="quick-filter-area-polygon"
              onClick={() => chooseArea("polygon")}
              aria-pressed={polygonActive}
            >
              <Pentagon size={16} aria-hidden="true" />
              {t("drawPolygonOption")}
            </button>
            {hasShape && (
              <button
                type="button"
                className="quickFilterAreaItem"
                data-testid="quick-filter-area-clear"
                onClick={() => chooseArea("clear")}
              >
                <Trash size={16} aria-hidden="true" />
                {t("quickFilterAreaClear")}
              </button>
            )}
          </div>
        )}
      </div>
      {hasShape && (
        <button
          type="button"
          className="quickFilterButton"
          data-testid="quick-filter-zoom-area"
          onClick={() =>
            zoomToGeometry(
              { type: "Polygon", coordinates: [polygon] },
              AREA_CAMERA,
            )
          }
          title={t("quickFilterZoomAreaTitle")}
          aria-label={t("quickFilterZoomAreaTitle")}
        >
          <ZoomIn size={18} aria-hidden="true" />
          <span className="quickFilterCaption" aria-hidden="true">
            {t("quickFilterCaptionZoomArea")}
          </span>
        </button>
      )}
      <button
        type="button"
        className={classNames("quickFilterButton", { applied: onlyInView })}
        data-testid="quick-filter-in-view"
        data-tip-highlight={tipHighlight("inView")}
        onClick={() => setOnlyInView(!onlyInView)}
        aria-pressed={onlyInView}
        title={t("quickFilterInViewTitle")}
        aria-label={countedLabel(
          onlyInView,
          inViewCount,
          t("quickFilterCaptionInView"),
        )}
        aria-describedby={
          countsReady && !onlyInView ? inViewCountId : undefined
        }
      >
        <Eye size={18} aria-hidden="true" />
        {countPreview(
          onlyInView,
          inViewCount,
          inViewCountId,
          "quick-filter-in-view-count",
        )}
        <span className="quickFilterCaption" aria-hidden="true">
          {t("quickFilterCaptionInView")}
        </span>
      </button>
      <button
        type="button"
        className={classNames("quickFilterButton", { applied: realtimeOnly })}
        data-testid="quick-filter-realtime"
        data-tip-highlight={tipHighlight("realtime")}
        onClick={() => setRealtimeOnly(!realtimeOnly)}
        aria-pressed={realtimeOnly}
        title={t("quickFilterRealtimeTitle")}
        aria-label={countedLabel(
          realtimeOnly,
          realtimeCount,
          t("quickFilterCaptionRealtime"),
        )}
        aria-describedby={
          countsReady && !realtimeOnly ? realtimeCountId : undefined
        }
      >
        <BroadcastPin size={18} aria-hidden="true" />
        {countPreview(
          realtimeOnly,
          realtimeCount,
          realtimeCountId,
          "quick-filter-realtime-count",
        )}
        <span className="quickFilterCaption" aria-hidden="true">
          {t("quickFilterCaptionRealtime")}
        </span>
      </button>
      {sourceAvailable && (
        <button
          type="button"
          className={classNames("quickFilterButton quickFilterSource", {
            applied: sourceMode !== "all",
          })}
          data-testid="quick-filter-source"
          onClick={cycleSource}
          title={t(SOURCE_NEXT_TITLE[sourceMode])}
          aria-label={t("quickFilterSourceLabel", {
            source: t(SOURCE_LABEL[sourceMode]),
          })}
        >
          <Database size={18} aria-hidden="true" />
          <span className="quickFilterCaption" aria-hidden="true">
            {t(SOURCE_CAPTION[sourceMode])}
          </span>
        </button>
      )}
      <button
        type="button"
        className="quickFilterButton quickFilterReset"
        data-testid="quick-filter-reset"
        // Disabled rather than removed so the row keeps its shape.
        disabled={!canReset}
        onClick={resetAll}
        title={t("resetFiltersButtonTooltipText")}
        aria-label={t("resetFiltersButtonTooltipText")}
      >
        <ArrowCounterclockwise size={18} aria-hidden="true" />
        <span className="quickFilterCaption" aria-hidden="true">
          {t("quickFilterCaptionClear")}
        </span>
      </button>
    </div>
  );
}
