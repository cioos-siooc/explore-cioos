import * as React from "react";
import { useCallback, useEffect } from "react";
import { X } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";

import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import useWideView from "../../../state/selection/useWideView.js";
import "./styles.css";

// The card's close button parks with the card under the sidebar or a dataset
// page, while the clicked hex, marker or grid box stays outlined on the map.
// An open dataset narrows the map to itself, so clearing closes it too. The
// open datasets list carries its own Clear beside the click's datasets.
// Escape presses it, after anything nearer has had its turn.
export default function ClearMapSelection() {
  const { t } = useTranslation();
  const { featureQuery, setFeatureQuery, depthToolActive } = useMapState();
  const { inspectDataset, returnToDatasetList } = useSelection();
  const { sidebarOpen } = useUI();
  const [wideParam] = useWideView();
  const shown = Boolean(inspectDataset || (featureQuery && !sidebarOpen));

  const clear = useCallback(() => {
    if (inspectDataset) returnToDatasetList();
    setFeatureQuery(null);
  }, [inspectDataset, returnToDatasetList, setFeatureQuery]);

  // A wide card and the depth tool each take Escape first; their listeners
  // are not ordered against this one, so this one stands down meanwhile.
  const escapes = shown && !(sidebarOpen && wideParam) && !depthToolActive;
  useEffect(() => {
    if (!escapes) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        clear();
      }
    };
    window.addEventListener("keydown", onKeyDown); // eslint-disable-line no-restricted-syntax -- keep: Escape clears the map selection unless something nearer claimed it first
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [escapes, clear]);

  if (!shown) return null;

  return (
    <button
      type="button"
      className="mapClickClear clearMapSelection"
      data-testid="clear-map-selection"
      onClick={clear}
      title={t(
        inspectDataset
          ? "mapDatasetSelectionClearTitle"
          : "mapSelectionClearTitle",
      )}
    >
      <span className="mapClickClearIcon" aria-hidden="true">
        <X size={20} />
      </span>
      {t(
        inspectDataset
          ? "mapDatasetSelectionClearText"
          : "mapSelectionClearText",
      )}
    </button>
  );
}
