import * as React from "react";
import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  Dash,
  Download,
  FileEarmarkText,
  ListUl,
  PlusCircle,
  QuestionCircle,
} from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";
import classNames from "classnames";
import isEmpty from "lodash-es/isEmpty";

import { useChanged } from "../../../utilities.jsx";
import CloseButton from "../../ui/CloseButton.jsx";
import useSheetDrag from "../../ui/useSheetDrag.js";
import DatasetsPanel from "../Panels/DatasetsPanel.jsx";
import Spinner from "../../ui/Spinner.jsx";
import useDatasetCounts from "../../../state/useDatasetCounts.js";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import { useTips } from "../../../state/tips/TipsProvider.jsx";
import useBackDismiss from "../../../state/ui/useBackDismiss.js";
import useMediaQuery, {
  MOBILE_QUERY,
} from "../../../state/ui/useMediaQuery.js";
import "./styles.css";
import "../../ui/sheetHandleStyles.css";

// A dataset page swaps the header for a banner so the two surfaces the card
// hosts can be told apart. Map minimizes the page to a card (DatasetMapCard),
// keeping the map keyed to it; the X leaves the dataset.
export default function Sidebar() {
  const { t } = useTranslation();
  const { pointsToReview, inspectDataset, returnToDatasetList } =
    useSelection();
  const {
    sidebarOpen,
    setSidebarOpen,
    setShowDownloadModal,
    setShowSelectionHelpModal,
  } = useUI();
  const { offerTip, tipHighlight } = useTips();
  // Until `ready` there is no count to show, not even a zero.
  const {
    ready: countsReady,
    updating: countsUpdating,
    title: countsTitle,
    label: countLabel,
  } = useDatasetCounts();

  const expanded = sidebarOpen;
  // On a phone the card is a bottom sheet like the Filters, Download and
  // Coverage ones: dragged down by its handle or header, and closed by Back.
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const cardRef = useRef(null);
  const startDrag = useSheetDrag(cardRef, () => setSidebarOpen(false));
  // Raised over a dataset page (a map click, a share link, the minimized
  // card), the sheet takes no history entry: it would sit above the page's own,
  // and leaving the page from in here and then closing the sheet would pop back
  // onto the page just left. Back closes the page first instead.
  const [backable, setBackable] = useState(false);
  if (useChanged(expanded) && expanded) setBackable(!inspectDataset);
  useBackDismiss(isMobile && expanded && backable, () => setSidebarOpen(false));
  const inspecting = Boolean(inspectDataset);
  const selectedCount = isEmpty(pointsToReview) ? 0 : pointsToReview.length;
  // Adding to the selection is when download tips start to matter.
  const lastSelectedCount = useRef(selectedCount);
  useEffect(() => {
    if (selectedCount > lastSelectedCount.current) {
      offerTip(["filtersCutDownload", "directLinks"]);
    }
    lastSelectedCount.current = selectedCount;
  }, [selectedCount, offerTip]);

  const collapseButton = (
    <CloseButton
      label={t("sidebarCollapseTitle")}
      onClick={() => setSidebarOpen(false)}
      testId="sidebar-collapse"
    />
  );

  return (
    <aside
      className="sidebar"
      aria-label={t("datasetsFilterName")}
      data-testid="sidebar"
    >
      <section
        ref={cardRef}
        className={classNames("sidebarDatasets", { expanded })}
        data-testid="sidebar-datasets"
        data-expanded={expanded}
        data-map-cover={expanded || undefined}
        onPointerDown={
          isMobile
            ? (event) => {
                if (
                  event.target.closest(
                    ".sheetHandle, .datasetsHeader, .datasetsBanner",
                  )
                )
                  startDrag(event);
              }
            : undefined
        }
      >
        {isMobile && <div className="sheetHandle" aria-hidden="true" />}
        {inspecting ? (
          <div className="datasetsBanner">
            {/* Names the destination, so it needs no tooltip. */}
            <button
              type="button"
              className="datasetsBackButton"
              data-testid="sidebar-back"
              onClick={returnToDatasetList}
            >
              <ChevronLeft
                className="datasetsBackButtonIcon"
                size={14}
                aria-hidden="true"
              />
              <span>{t("sidebarBackToDatasetsText")}</span>
            </button>
            <span className="datasetsBannerMode">
              <FileEarmarkText size={13} aria-hidden="true" />
              {t("sidebarDatasetDetailsLabel")}
            </span>
            <CloseButton
              label={t("sidebarShowMapTitle")}
              onClick={() => setSidebarOpen(false)}
              icon={Dash}
              testId="sidebar-collapse"
            />
            <CloseButton
              label={t("closeDatasetText")}
              onClick={() => {
                returnToDatasetList();
                setSidebarOpen(false);
              }}
              testId="sidebar-close-dataset"
            />
          </div>
        ) : (
          <div className="datasetsHeader">
            <span className="datasetsHeaderIcon" aria-hidden="true">
              <ListUl size={20} />
            </span>
            <span className="datasetsHeaderText">
              <span className="datasetsHeaderTitleRow">
                <span className="datasetsHeaderLabel">
                  {t("datasetsFilterName")}
                </span>
                <span
                  className={classNames("datasetsHeaderCount", {
                    updating: countsUpdating,
                  })}
                  data-testid="sidebar-toggle-count"
                  title={countsTitle}
                >
                  {countsReady ? (
                    countLabel
                  ) : (
                    <Spinner size="xs" className="countSpinner" />
                  )}
                </span>
              </span>
              <span className="datasetsHeaderSubtitle">
                {t("datasetsToggleSubtitleText")}
              </span>
            </span>
            {collapseButton}
          </div>
        )}
        <div className="sidebarBody" data-testid="sidebar-body">
          <DatasetsPanel />
        </div>
        <footer className="sidebarFooter" data-testid="sidebar-footer">
          {/* The per-card control is a bare icon, so this line names it. */}
          <p
            className="sidebarFooterHint"
            title={t("sidebarSelectionHintTitle")}
          >
            <PlusCircle
              className="sidebarFooterHintIcon"
              size={13}
              aria-hidden="true"
            />
            <span>{t("sidebarSelectionHintText")}</span>
            <button
              type="button"
              className="sidebarFooterHintMore"
              data-testid="sidebar-selection-help"
              onClick={() => setShowSelectionHelpModal(true)}
              aria-label={t("sidebarSelectionHintMoreText")}
              title={t("sidebarSelectionHintMoreText")}
            >
              <QuestionCircle size={13} aria-hidden="true" />
            </button>
          </p>
          <button
            type="button"
            className="sidebarDownloadButton"
            data-tip-highlight={
              tipHighlight("filtersCutDownload") || tipHighlight("directLinks")
            }
            disabled={selectedCount === 0}
            onClick={() => setShowDownloadModal(true)}
            title={t("dockDownloadCountTitle", { count: selectedCount })}
          >
            <Download size={16} aria-hidden="true" />
            <span className="sidebarDownloadText">
              {t("downloadModalButtonText")}
              {/* Keyed on the count so each change replays the pulse. */}
              <span className="sidebarDownloadCount" key={selectedCount}>
                {t("sidebarCountsSelected", { count: selectedCount })}
              </span>
            </span>
          </button>
        </footer>
      </section>
    </aside>
  );
}
