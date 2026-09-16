import * as React from "react";
import { useEffect, useState } from "react";
import { BoundingBox, Check2, Clipboard, Pentagon } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";

import { polygonIsRectangle, polygonToWkt } from "../../../../utilities.jsx";
import { useMapState } from "../../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../../state/selection/SelectionProvider.jsx";
import { useUI } from "../../../../state/ui/UIProvider.jsx";
import "../MultiCheckboxFilter/styles.css";
import "./styles.css";

// The Area filter inside the Filters panel — the same drawn box/polygon as
// the top bar's spatial filter button (SpatialFilterButton), reading the
// same state (polygon, in SelectionProvider) and issuing the same one-shot
// draw request (requestDraw, in MapStateProvider). Unlike that button's
// dropdown, which floats over a corner of the still-visible map, the Filters
// modal covers it — so picking a shape here closes the modal first, the same
// way a phone's Filters view already hides the map, then reappears once the
// user is done.
//
// No "arm the last-used tool on open" behaviour here: the button auto-arms
// because opening its menu *is* the start of drawing, but opening this pane
// is just browsing filters, so only an explicit click on a shape starts a
// draw. That also means there is nothing to remember once no shape is drawn
// — the two rows sit unhighlighted until one is.
export default function SpatialFilter() {
  const { t } = useTranslation();
  const { requestDraw } = useMapState();
  const { polygon } = useSelection();
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

  function startDraw(mode) {
    setShowFiltersModal(false);
    requestDraw(mode);
  }

  return (
    <div className="multiCheckboxFilter spatialFilterOptions">
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
      {hasSelection && (
        <button
          type="button"
          className="spatialFilterCopyWkt"
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
          {t(wktCopied ? "copiedSelectionWktTitle" : "copySelectionWktTitle")}
        </button>
      )}
    </div>
  );
}
