import * as React from "react";
import { X } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";

import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import "./styles.css";

// The card's close button parks with the card under the sidebar or a dataset
// page, while the clicked hex, marker or grid box stays outlined on the map.
// An open dataset narrows the map to itself, so clearing closes it too.
export default function ClearMapSelection() {
  const { t } = useTranslation();
  const { featureQuery, setFeatureQuery } = useMapState();
  const { inspectDataset, returnToDatasetList } = useSelection();
  if (!featureQuery && !inspectDataset) return null;

  const clear = () => {
    if (inspectDataset) returnToDatasetList();
    setFeatureQuery(null);
  };

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
