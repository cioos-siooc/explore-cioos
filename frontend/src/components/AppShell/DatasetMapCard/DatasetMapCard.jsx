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
import useMediaQuery, {
  MOBILE_QUERY,
} from "../../../state/ui/useMediaQuery.js";
import "./styles.css";

// Closing the sidebar keeps the map keyed to the open dataset, so this card
// names it, reopens its page and is the one way out. Never gives way to a map
// click: the "what's here" card stays shut while a dataset is open.
export function DatasetMapCorner() {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const { inspectDataset } = useSelection();
  const { sidebarOpen } = useUI();

  if (isMobile || !inspectDataset || sidebarOpen) return null;
  return <DatasetMapCard dataset={inspectDataset} className="corner" />;
}

export default function DatasetMapCard({ dataset, className }) {
  const { t } = useTranslation();
  const { returnToDatasetList } = useSelection();
  const { activeWmsOverlay, setActiveWmsOverlay } = useMapState();
  const { setSidebarOpen } = useUI();
  const { zoomToDataset, canZoom } = useZoomToDataset();

  const overlay =
    activeWmsOverlay?.pk === dataset.pk ? activeWmsOverlay : undefined;

  return (
    <section
      className={classNames("datasetMapCard", className, {
        withOverlay: overlay,
      })}
      data-testid="dataset-map-card"
      data-map-cover
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
          <FileEarmarkText size={12} aria-hidden="true" />
          {t("datasetMapCardDetailsText")}
        </button>
        {canZoom && (
          <button
            type="button"
            className="datasetMapCardButton"
            onClick={zoomToDataset}
            title={t("zoomToDatasetTitle")}
          >
            <ZoomIn size={12} aria-hidden="true" />
            {t("singleDatasetZoomText")}
          </button>
        )}
      </div>
      {/* No close of its own: a second X would read as leaving the dataset. */}
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
