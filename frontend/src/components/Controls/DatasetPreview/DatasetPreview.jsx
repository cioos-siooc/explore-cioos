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
import { PANE_DEFAULT_PX } from "./previewPaneLayout.js";
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
  const { t } = useTranslation();

  // The response arrives as parallel arrays; the table wants row objects. That
  // is a reading of the response, so it is derived rather than copied into state
  // by an effect — which also means there is nothing to clear on close.
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

  // What is being looked at and how it is drawn — all of it in the query string,
  // so a link reproduces the plot and Back closes it. Only the six the header
  // and the body need are read here; the rest goes to the plot through the
  // provider below.
  const plotParams = usePreviewPlotParams(
    inspectDataset,
    datasetPreview?.table,
    rows,
  );
  const { selectedVis, setSelectedVis, linkKey } = plotParams;

  // Fetched separately from the rows and independent of them: a record whose
  // list fails simply gets no slider.
  const profiles = usePreviewProfiles(
    inspectDataset?.dataset_id,
    inspectRecordID,
  );

  // Per-column display names. Deliberately NOT in the URL: free text is what
  // makes a query string unreadable, and a rename is a private annotation rather
  // than a view.
  const [customLabels, setCustomLabels] = useState(NO_CUSTOM_LABELS);

  // Which URL the Copy button is currently claiming. Held as the copied key
  // rather than a boolean so "still the link they copied?" is derived from the
  // URL instead of re-synced to it: anything that changes the query string makes
  // this stale by definition, with no effect to run.
  const [copiedLinkKey, setCopiedLinkKey] = useState(NO_LINK_COPIED);
  const linkCopied = copiedLinkKey === linkKey;
  const copyLinkText = t(
    linkCopied ? "copiedPreviewLinkTitle" : "copyPreviewLinkTitle",
  );

  // A viewing preference like the disclosure triangle in the plot, not a view of
  // the data — so not in the URL, and not reset per record.
  const [paneWidth, setPaneWidth] = useState(PANE_DEFAULT_PX);
  const [paneCollapsed, setPaneCollapsed] = useState(false);

  // The Table view's scroll container, and the CEILING on the plot's height.
  // Measured here because its height is set by the modal (flex, capped at the
  // viewport) and does not move when the plot grows, which is what makes it safe
  // to feed into the plot's height.
  const [scrollRef, scrollSize] = useElementSize();

  // A different record is a different plot: drop the previous one's names.
  // Adjusted during render rather than from an effect — React discards this
  // render and immediately re-runs with the cleared labels, so the new record
  // never paints under the old record's names.
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
    // One call, one history entry: setInspectRecordID clears ?preview= and every
    // plot param together, because react-router would drop one of two writes
    // made in the same tick (see previewParams.js).
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
            </h4>

            {dataIsReady && (
              // The address bar is already the live mirror of the whole app
              // state — record, plot settings, map and filters — so sharing what
              // is on screen is the current URL and nothing more.
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
