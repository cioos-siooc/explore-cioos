import * as React from "react";
import { useEffect, useRef } from "react";
import {
  ChevronLeft,
  Download,
  FileEarmarkText,
  ListUl,
  Map as MapIcon,
  PlusCircle,
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
import { useTips } from "../../../state/tips/TipsProvider.jsx";
import "./styles.css";

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
        className={classNames("sidebarDatasets", { expanded })}
        data-testid="sidebar-datasets"
        data-expanded={expanded}
        data-map-cover={expanded || undefined}
      >
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
            <button
              type="button"
              className="datasetsMapButton"
              data-testid="sidebar-collapse"
              onClick={() => setSidebarOpen(false)}
              title={t("sidebarShowMapTitle")}
            >
              <MapIcon size={14} aria-hidden="true" />
              <span>{t("sidebarShowMapText")}</span>
            </button>
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
