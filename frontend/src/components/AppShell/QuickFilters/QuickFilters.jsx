import * as React from "react";
import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowCounterclockwise,
  BoundingBox,
  BroadcastPin,
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
import {
  Menu,
  MenuButton,
  MenuItem,
  MenuSection,
  MenuTrigger,
} from "../../ui/Dropdown.jsx";
import "./styles.css";

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
  const zoomedIn = isMarkerTier(zoom) && !onlyInView;
  useEffect(() => {
    if (zoomedIn) offerTip("inView");
  }, [zoomedIn, offerTip]);

  const inViewCountId = useId();
  const realtimeCountId = useId();
  const [areaMenuOpen, setAreaMenuOpen] = useState(false);
  const [armedMode, setArmedMode] = useState(null);
  // Picking an item closes the menu too; that close mustn't disarm the pick.
  const picked = useRef(false);

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
    picked.current = true;
    requestDraw(mode);
    setArmedMode(mode === "clear" ? null : mode);
  }

  // Opening arms the box tool so one click starts drawing; arming wipes the
  // drawn shape, so not when there is one. A click elsewhere closes the menu
  // without disarming: it is usually the first corner of the box.
  function onAreaMenuOpenChange(open, reason) {
    setAreaMenuOpen(open);
    const keepArmed = picked.current || reason === "outside";
    picked.current = false;
    if (open) {
      if (hasShape) return;
      requestDraw("box");
      setArmedMode("box");
    } else if (!keepArmed && !hasShape && armedMode) {
      requestDraw("clear");
      setArmedMode(null);
    }
  }

  return (
    <div
      className="quickFilters"
      role="group"
      aria-label={t("topBarQuickFiltersLabel")}
      data-testid="quick-filters"
    >
      <div
        className={classNames("quickFilterArea", { open: areaMenuOpen })}
        title={
          areaPlace
            ? `${t("spatialFilterFilterName")}: ${areaPlace.name}`
            : t("quickFilterAreaTitle")
        }
      >
        {/* Non-modal: the map stays live under it for that first corner. */}
        <MenuTrigger
          isOpen={areaMenuOpen}
          onOpenChange={onAreaMenuOpenChange}
          nonModal
          className="quickFilterAreaMenu"
        >
          <MenuButton
            className={classNames("quickFilterButton", { applied: hasShape })}
            data-testid="quick-filter-area"
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
            <span
              className={classNames("quickFilterCaption", {
                quickFilterCaptionPlace: areaPlace,
              })}
              aria-hidden="true"
            >
              {areaPlace ? areaPlace.name : t("quickFilterCaptionArea")}
            </span>
          </MenuButton>
          <Menu data-testid="quick-filter-area-menu" onAction={chooseArea}>
            <MenuSection
              selectionMode="single"
              selectedKeys={
                boxActive ? ["box"] : polygonActive ? ["polygon"] : []
              }
            >
              <MenuItem
                id="box"
                className="quickFilterAreaItem"
                data-testid="quick-filter-area-box"
                textValue={t("drawBoundingBoxOption")}
              >
                <BoundingBox size={16} aria-hidden="true" />
                {t("drawBoundingBoxOption")}
              </MenuItem>
              <MenuItem
                id="polygon"
                className="quickFilterAreaItem"
                data-testid="quick-filter-area-polygon"
                textValue={t("drawPolygonOption")}
              >
                <Pentagon size={16} aria-hidden="true" />
                {t("drawPolygonOption")}
              </MenuItem>
            </MenuSection>
            {hasShape && (
              <MenuSection>
                <MenuItem
                  id="clear"
                  className="quickFilterAreaItem"
                  data-testid="quick-filter-area-clear"
                  textValue={t("quickFilterAreaClear")}
                >
                  <Trash size={16} aria-hidden="true" />
                  {t("quickFilterAreaClear")}
                </MenuItem>
              </MenuSection>
            )}
          </Menu>
        </MenuTrigger>
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
