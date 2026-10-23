import * as React from "react";
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Check2, Link45deg } from "react-bootstrap-icons";

import Modal from "../../ui/Modal.jsx";
import useElementSize from "../../ui/useElementSize.js";

import PreviewBody from "./PreviewBody.jsx";
import PreviewPlotProvider from "./PreviewPlotProvider.jsx";
import usePreviewPlotParams from "./usePreviewPlotParams.js";
import usePreviewProfiles from "./usePreviewProfiles.js";
import { previewSampleFor } from "./previewSample.js";
import { PANE_DEFAULT_PX } from "./previewPaneLayout.js";
import { COLOR_LAYOUT } from "../../../state/selection/previewParams.js";
import "./styles.css";

const NO_CUSTOM_LABELS = {};
// Never equal to a linkKey (which is a query string, and may be ""), so the
// button starts un-copied and returns there the moment the URL moves on.
const NO_LINK_COPIED = Symbol("no link copied");

export default function DatasetPreview({
  datasetPreview,
  previewError,
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
  const { t, i18n } = useTranslation();

  const rows = useMemo(() => {
    const columnNames = datasetPreview?.table?.columnNames || [];
    const table = datasetPreview?.table?.rows || [];
    return table.map((row) =>
      columnNames.reduce(
        (merged, key, index) => ({ ...merged, [key]: row[index] }),
        {},
      ),
    );
  }, [datasetPreview]);

  // Plot state lives in the query string so a link reproduces the plot and Back
  // closes it. Only the six the header and the body need are read here; the rest
  // goes to the plot through the provider below.
  const plotParams = usePreviewPlotParams(
    inspectDataset,
    datasetPreview?.table,
    rows,
  );
  const { selectedVis, setSelectedVis, linkKey, plotLayout, step } = plotParams;

  // Fetched separately from the rows and independent of them: a record whose
  // list fails simply gets no slider.
  const profiles = usePreviewProfiles(
    inspectDataset?.dataset_id,
    inspectRecordID,
  );

  // Said beside the title, so the table and both plot layouts all say it.
  const sample = useMemo(
    () =>
      previewSampleFor({
        sample: datasetPreview?.sample,
        rows,
        profiles,
        drawsOneProfile:
          plotLayout !== COLOR_LAYOUT && Boolean(step || profiles.current),
      }),
    [datasetPreview, rows, profiles, plotLayout, step],
  );
  const formatCount = (count) => count.toLocaleString(i18n.language);

  // Deliberately not in the URL: free text makes the query string unreadable,
  // and a rename is a private annotation rather than a view.
  const [customLabels, setCustomLabels] = useState(NO_CUSTOM_LABELS);

  // The copied key rather than a boolean, so any URL change makes it stale
  // without an effect to re-sync it.
  const [copiedLinkKey, setCopiedLinkKey] = useState(NO_LINK_COPIED);
  const linkCopied = copiedLinkKey === linkKey;
  const copyLinkText = t(
    linkCopied ? "copiedPreviewLinkTitle" : "copyPreviewLinkTitle",
  );

  // A viewing preference like the disclosure triangle in the plot, not a view of
  // the data — so not in the URL, and not reset per record.
  const [paneWidth, setPaneWidth] = useState(PANE_DEFAULT_PX);
  const [paneCollapsed, setPaneCollapsed] = useState(false);

  // The Table view's scroll container and the ceiling on the plot's height:
  // sized by the modal, not the plot, so it is safe to feed into the plot's
  // height.
  const [scrollRef, scrollSize] = useElementSize();

  // Reset during render, not in an effect, so a new record never paints with
  // the previous record's names.
  const [labelledRecordID, setLabelledRecordID] = useState(inspectRecordID);
  if (labelledRecordID !== inspectRecordID) {
    setLabelledRecordID(inspectRecordID);
    setCustomLabels(NO_CUSTOM_LABELS);
  }

  const plotValue = {
    ...plotParams,
    inspectDataset,
    inspectRecordID,
    profiles,
    customLabels,
    setCustomLabels,
    paneWidth,
    setPaneWidth,
    paneCollapsed,
    setPaneCollapsed,
    availableHeight: scrollSize.height,
  };

  const onModalClose = () => {
    // One call clears ?preview= and every plot param: react-router drops one of
    // two writes made in the same tick (see previewParams.js).
    setInspectRecordID();
    setCustomLabels(NO_CUSTOM_LABELS);
    setRecordLoading(false);
  };
  const dataIsReady = !recordLoading && datasetPreview?.table?.rows;

  return (
    <Modal
      className="dataPreviewModal"
      show={showModal}
      size="xl"
      onHide={onModalClose}
      centered
    >
      {inspectDataset && inspectRecordID && (
        <PreviewPlotProvider value={plotValue}>
          <Modal.Header closeButton className="tableAndPlotGridContainer">
            {dataIsReady && (
              <>
                <button
                  className={`toggleButton ${
                    selectedVis === "plot" && "selected"
                  }`}
                  onClick={() => setSelectedVis("plot")}
                >
                  {t("datasetPreviewPlotText")}
                </button>
                <button
                  className={`toggleButton ${
                    selectedVis === "table" && "selected"
                  }`}
                  onClick={() => setSelectedVis("table")}
                >
                  {t("datasetPreviewTableText")}
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
              {dataIsReady && sample && (
                <span className="datasetPreviewSample">
                  {t(
                    sample.profileCount === null
                      ? "datasetPreviewSampleRows"
                      : plotLayout === COLOR_LAYOUT
                        ? "datasetPreviewSampleAllProfiles" // the colour plot draws every profile it loaded
                        : "datasetPreviewSampleProfiles",
                    {
                      rows: formatCount(sample.rowCount),
                      totalRows: formatCount(sample.totalRowCount),
                      profiles: formatCount(sample.profileCount ?? 0),
                      totalProfiles: formatCount(sample.totalProfileCount ?? 0),
                    },
                  )}
                </span>
              )}
            </h4>

            {dataIsReady && (
              // The URL mirrors the whole app state, so it is the share link.
              <button
                type="button"
                className="copyLinkButton"
                aria-label={copyLinkText}
                title={copyLinkText}
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                  setCopiedLinkKey(linkKey);
                }}
              >
                {linkCopied ? (
                  <Check2 size={18} aria-hidden="true" />
                ) : (
                  <Link45deg size={18} aria-hidden="true" />
                )}
              </button>
            )}
          </Modal.Header>
          <Modal.Body>
            <div className="tableAndPlotGridItem tableAndPlot" ref={scrollRef}>
              <PreviewBody
                recordLoading={recordLoading}
                datasetPreview={datasetPreview}
                rows={rows}
                previewError={previewError}
              />
            </div>
          </Modal.Body>
        </PreviewPlotProvider>
      )}
    </Modal>
  );
}
