import * as React from "react";
import { FileEarmarkText, ZoomIn } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import CloseButton from "../../ui/CloseButton.jsx";
import WmsLegend from "../../Controls/WmsLegend/WmsLegend.jsx";
import { useZoomToDataset } from "../ZoomToDataset/ZoomToDataset.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import "./styles.css";

// The dataset page, minimized: closing the sidebar while a dataset is open
// keeps the map keyed to that dataset (the others grey, its WMS layer drawn),
// so this card under the brand card names it, reopens its page, and is the one
// way out. A gridded dataset's colorbar and slice controls ride in the same
// card rather than in a second one elsewhere on screen, since they describe
// the same dataset.
export default function DatasetMapCard({ dataset }) {
  const { t } = useTranslation();
  const { returnToDatasetList } = useSelection();
  const { activeWmsOverlay, setActiveWmsOverlay } = useMapState();
  const { setSidebarOpen } = useUI();
  const { zoomToDataset, canZoom } = useZoomToDataset();

  const overlay =
    activeWmsOverlay?.pk === dataset.pk ? activeWmsOverlay : undefined;

  return (
    <section
      className={classNames("datasetMapCard", { withOverlay: overlay })}
      data-testid="dataset-map-card"
      aria-label={dataset.title}
    >
      <div className="datasetMapCardHead">
        <span className="datasetMapCardTitle" title={dataset.title}>
          {dataset.title}
        </span>
        <CloseButton
          label={t("closeDatasetText")}
          onClick={returnToDatasetList}
          testId="dataset-map-card-close"
        />
      </div>
      <div className="datasetMapCardActions">
        <button
          type="button"
          className="datasetMapCardButton primary"
          data-testid="dataset-map-card-details"
          onClick={() => setSidebarOpen(true)}
          title={t("sidebarShowDatasetTitle")}
        >
          <FileEarmarkText size={14} aria-hidden="true" />
          {t("datasetMapCardDetailsText")}
        </button>
        {/* A dataset with no footprint has nothing to frame. */}
        {canZoom && (
          <button
            type="button"
            className="datasetMapCardButton"
            onClick={zoomToDataset}
            title={t("zoomToDatasetTitle")}
          >
            <ZoomIn size={14} aria-hidden="true" />
            {t("singleDatasetZoomText")}
          </button>
        )}
      </div>
      {/* No close of its own here: the card's X already leaves the dataset,
          and a second X for the layer alone would read as the same thing. The
          page's Show on map switch turns the layer off. */}
      {overlay && (
        <WmsLegend
          overlay={overlay}
          variant="card"
          setActiveWmsOverlay={setActiveWmsOverlay}
        />
      )}
    </section>
  );
}
