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
  const { zoomToDataset, canZoom, framed } = useZoomToDataset();

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
      {/* One row, so the picker below gets the height: the title opens the
          page, and zoom sits with the X. */}
      <div className="datasetMapCardHead">
        <button
          type="button"
          className="datasetMapCardTitle"
          data-testid="dataset-map-card-details"
          onClick={() => setSidebarOpen(true)}
          title={t("sidebarShowDatasetTitle")}
          aria-label={`${t("datasetMapCardDetailsText")}: ${dataset.title}`}
        >
          {/* The page's own title icon, in the text like on that page. */}
          <span className="datasetMapCardTitleText">
            <FileEarmarkText
              className="datasetMapCardTitleIcon"
              aria-hidden="true"
            />
            {dataset.title}
          </span>
        </button>
        {/* Same framed state as the page's own zoom button. */}
        {canZoom && (
          <button
            type="button"
            className="datasetMapCardZoom"
            onClick={framed ? undefined : zoomToDataset}
            title={t(
              framed ? "zoomToDatasetFramedTitle" : "zoomToDatasetTitle",
            )}
            aria-label={t("zoomToDatasetTitle")}
            aria-disabled={framed || undefined}
          >
            <ZoomIn aria-hidden="true" />
          </button>
        )}
        <CloseButton
          label={t("closeDatasetText")}
          onClick={returnToDatasetList}
          testId="dataset-map-card-close"
        />
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
