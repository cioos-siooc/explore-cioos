import * as React from "react";
import {
  ChevronLeft,
  Download,
  FileEarmarkText,
  ListUl,
  QuestionCircle,
} from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";
import classNames from "classnames";
import isEmpty from "lodash-es/isEmpty";

import CloseButton from "../../ui/CloseButton.jsx";
import DatasetsPanel from "../Panels/DatasetsPanel.jsx";
import Spinner from "../../ui/Spinner.jsx";
import useDatasetCounts from "../../../state/useDatasetCounts.js";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import "./styles.css";

// The left column: the datasets card — a header naming the list, the list
// itself, and the counts + Download footer. (The brand and the
// Datasets/Filters entry points live in the centered top bar, which is also
// what asks for this card.) On phones the same card takes the whole screen;
// closed, nothing of it is left at any edge.
// Drilling into a single dataset swaps that header for a back banner: the card
// hosts two different surfaces, and the header is what names the one in view.
// Either way the way out is the app's one close button, in the corner.
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
  // Until `ready`, there is no dataset count to show — not even a zero. See
  // useDatasetCounts.
  const {
    ready: countsReady,
    updating: countsUpdating,
    filteredCount,
    total,
    allDatasetsShown,
    label: countLabel,
  } = useDatasetCounts();

  const expanded = sidebarOpen;
  // The panel is on a single dataset rather than the list. The banner swaps
  // with it, so the card never leaves the user guessing which of the two
  // surfaces they are on — and the way back is in the banner, not buried in
  // the page's own title block.
  const inspecting = Boolean(inspectDataset);
  const selectedCount = isEmpty(pointsToReview) ? 0 : pointsToReview.length;
  const countsTitle = countsReady
    ? t("dockDatasetsCountTitle", {
        filtered: filteredCount,
        // A failed /datasets leaves no catalog total; the filtered count is
        // then all we know, and all the label shows.
        total: total ?? filteredCount,
      })
    : t("datasetsCountLoadingTitle");

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
        className={classNames("sidebarDatasets", { expanded })}
        data-testid="sidebar-datasets"
        data-expanded={expanded}
      >
        {inspecting ? (
          <div className="datasetsBanner">
            <button
              type="button"
              className="datasetsBackButton"
              data-testid="sidebar-back"
              onClick={returnToDatasetList}
              title={t("datasetInspectorBackButtonTitle")}
            >
              <ChevronLeft size={14} aria-hidden="true" />
              <span>{t("datasetsFilterName")}</span>
            </button>
            <span className="datasetsBannerMode">
              <FileEarmarkText size={13} aria-hidden="true" />
              {t("sidebarDatasetPageLabel")}
            </span>
            {collapseButton}
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
          {/* What the Download button below is fed by. The per-card control is
              a bare icon, so the one sentence that says which icon and where
              the picks end up lives here, against the count it changes —
              rather than only inside a modal nobody opens. */}
          <p className="sidebarFooterHint">
            <Download
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
            >
              <QuestionCircle size={12} aria-hidden="true" />
              {t("sidebarSelectionHintMoreText")}
            </button>
          </p>
          <div className="sidebarFooterActions">
            <div className="sidebarCounts">
              <span
                className={classNames("sidebarCountsDatasets", {
                  updating: countsUpdating,
                })}
                title={countsTitle}
              >
                {!countsReady ? (
                  <Spinner size="xs" className="countSpinner" />
                ) : allDatasetsShown ? (
                  t("sidebarCountsDatasetsAll", {
                    total: total ?? filteredCount,
                  })
                ) : (
                  t("sidebarCountsDatasets", {
                    filtered: filteredCount,
                    total,
                  })
                )}
              </span>
              <span
                className="sidebarCountsSelected"
                title={t("dockDownloadCountTitle", { count: selectedCount })}
              >
                {t("sidebarCountsSelected", { count: selectedCount })}
              </span>
            </div>
            <button
              type="button"
              className="sidebarDownloadButton"
              disabled={selectedCount === 0}
              onClick={() => setShowDownloadModal(true)}
              title={t("dockDownloadCountTitle", { count: selectedCount })}
            >
              <Download size={16} aria-hidden="true" />
              {t("downloadModalButtonText")}
              {selectedCount > 0 && (
                <span className="sidebarDownloadCount">{selectedCount}</span>
              )}
            </button>
          </div>
        </footer>
      </section>
    </aside>
  );
}
