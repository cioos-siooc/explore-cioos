import React, { useState, useMemo, Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { Check2, Clipboard } from "react-bootstrap-icons";

import Modal from "../../ui/Modal.jsx";
import Skeleton, { SkeletonGroup } from "../../ui/Skeleton.jsx";
import useElementSize from "../../ui/useElementSize.js";

import DatasetPreviewTable from "../DatasetPreviewTable/DatasetPreviewTable.jsx";
import usePreviewPlotParams from "./usePreviewPlotParams.js";
import "./styles.css";

// Lazy so the ~1 MB Plotly chunk stays separate and downloads alongside /preview.
const DatasetPreviewPlot = lazy(
  () => import("../DatasetPreviewPlot/DatasetPreviewPlot.jsx"),
);

const NO_CUSTOM_LABELS = {};
// Never equal to a linkKey (which is a query string, and may be ""), so the
// button starts un-copied and returns there the moment the URL moves on.
const NO_LINK_COPIED = Symbol("no link copied");

export default function DatasetPreview({
  datasetPreview,
  inspectDataset,
  inspectRecordID,
  // {start, end} UTC days when one period of the record is shown (a
  // trajectory's pass through the selected area) rather than its latest data.
  inspectRecordPeriod,
  setInspectRecordID,
  showModal,
  recordLoading,
  setRecordLoading,
}) {
  const { t } = useTranslation();

  const data = useMemo(() => {
    const columnNames = datasetPreview?.table?.columnNames || [];
    const rows = datasetPreview?.table?.rows || [];
    return rows.map((row) =>
      columnNames.reduce(
        (merged, key, index) => ({ ...merged, [key]: row[index] }),
        {},
      ),
    );
  }, [datasetPreview]);

  // Plot state lives in the query string so a link reproduces the plot and Back
  // closes it.
  const {
    variables,
    variablesByName,
    plan,
    selectedVis,
    setSelectedVis,
    sharedAxis,
    setSharedAxis,
    panels,
    setPanels,
    togglePanel,
    variableColors,
    setVariableColor,
    plotType,
    setPlotType,
    uirevision,
    linkKey,
  } = usePreviewPlotParams(inspectDataset, datasetPreview?.table, data);

  // Lifted out of the plot to survive the Table/Plot flip, but deliberately not
  // in the URL: free text makes the query string unreadable.
  const [customLabels, setCustomLabels] = useState(NO_CUSTOM_LABELS);

  // The copied key rather than a boolean, so any URL change makes it stale
  // without an effect to re-sync it.
  const [copiedLinkKey, setCopiedLinkKey] = useState(NO_LINK_COPIED);
  const linkCopied = copiedLinkKey === linkKey;

  // The modal's one scroll container: its height is set by the modal, not the
  // plot, so it is safe to feed into the plot's height.
  const [scrollRef, scrollSize] = useElementSize();

  // Reset during render, not in an effect, so a new record never paints with
  // the previous record's names.
  const [labelledRecordID, setLabelledRecordID] = useState(inspectRecordID);
  if (labelledRecordID !== inspectRecordID) {
    setLabelledRecordID(inspectRecordID);
    setCustomLabels(NO_CUSTOM_LABELS);
  }

  const onModalClose = () => {
    // One call clears ?preview= and every plot param: react-router drops one of
    // two writes made in the same tick (see previewParams.js).
    setInspectRecordID();
    setCustomLabels(NO_CUSTOM_LABELS);
    setRecordLoading(false);
  };
  const dataIsReady = !recordLoading && datasetPreview?.table?.rows;

  const plotSkeleton = (
    <SkeletonGroup className="datasetPreviewPlotLoading">
      <Skeleton radius="var(--cioos-radius)" />
    </SkeletonGroup>
  );

  return (
    <Modal
      className="dataPreviewModal"
      show={showModal}
      size="xl"
      onHide={onModalClose}
      centered
    >
      {inspectDataset && inspectRecordID && (
        <>
          <Modal.Header closeButton className="tableAndPlotGridContainer">
            {dataIsReady && (
              <>
                <button
                  className={`toggleButton ${
                    selectedVis === "table" && "selected"
                  }`}
                  onClick={() => setSelectedVis("table")}
                >
                  {t("datasetPreviewTableText")}
                </button>
                <button
                  className={`toggleButton ${
                    selectedVis === "plot" && "selected"
                  }`}
                  onClick={() => setSelectedVis("plot")}
                >
                  {t("datasetPreviewPlotText")}
                </button>
              </>
            )}

            <h4 className="datasetTitle">
              {inspectDataset.title}: <i>{inspectRecordID}</i>
              {inspectRecordPeriod && (
                <span className="datasetPreviewPeriod">
                  {t("datasetPreviewPeriodText", inspectRecordPeriod)}
                </span>
              )}
            </h4>

            {dataIsReady && (
              // The URL mirrors the whole app state, so it is the share link.
              <button
                type="button"
                className="copyLinkButton"
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                  setCopiedLinkKey(linkKey);
                }}
              >
                {linkCopied ? (
                  <Check2 size={16} aria-hidden="true" />
                ) : (
                  <Clipboard size={16} aria-hidden="true" />
                )}
                {t(
                  linkCopied
                    ? "copiedPreviewLinkTitle"
                    : "copyPreviewLinkTitle",
                )}
              </button>
            )}
          </Modal.Header>
          <Modal.Body>
            <div className="tableAndPlotGridItem tableAndPlot" ref={scrollRef}>
              {recordLoading ? (
                selectedVis === "table" ? (
                  <SkeletonGroup className="datasetPreviewTableSkeleton">
                    {Array.from({ length: 36 }, (_, i) => (
                      <Skeleton key={i} height={i < 4 ? "1.2em" : undefined} />
                    ))}
                  </SkeletonGroup>
                ) : (
                  plotSkeleton
                )
              ) : (
                <>
                  {datasetPreview?.table?.rows ? (
                    <>
                      {selectedVis === "table" ? (
                        <DatasetPreviewTable
                          datasetPreview={datasetPreview}
                          data={data}
                        />
                      ) : plan ? (
                        // The fallback reserves height: otherwise Plotly measures
                        // a collapsed box at zero.
                        <Suspense fallback={plotSkeleton}>
                          <DatasetPreviewPlot
                            inspectRecordID={inspectRecordID}
                            data={data}
                            variables={variables}
                            variablesByName={variablesByName}
                            plan={plan}
                            sharedAxis={sharedAxis}
                            setSharedAxis={setSharedAxis}
                            panels={panels}
                            togglePanel={togglePanel}
                            setPanels={setPanels}
                            variableColors={variableColors}
                            setVariableColor={setVariableColor}
                            plotType={plotType}
                            setPlotType={setPlotType}
                            customLabels={customLabels}
                            setCustomLabels={setCustomLabels}
                            uirevision={uirevision}
                            availableHeight={scrollSize.height}
                          />
                        </Suspense>
                      ) : (
                        // Only via ?vis=plot on a type with no layout (Grid), or
                        // a dataset whose columns are all coordinates and ids.
                        <p>{t("datasetPreviewPlotNotPlottable")}</p>
                      )}
                    </>
                  ) : (
                    <>
                      <p>{t("datasetPreviewNoData")}</p>
                    </>
                  )}
                </>
              )}
            </div>
          </Modal.Body>
        </>
      )}
    </Modal>
  );
}
