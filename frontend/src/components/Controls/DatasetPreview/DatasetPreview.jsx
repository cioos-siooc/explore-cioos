import React, { useState, useMemo, Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { Check2, Clipboard } from "react-bootstrap-icons";

import Modal from "../../ui/Modal.jsx";
import useElementSize from "../../ui/useElementSize.js";

import Loading from "../Loading/Loading.jsx";
import DatasetPreviewTable from "../DatasetPreviewTable/DatasetPreviewTable.jsx";
import usePreviewPlotParams from "./usePreviewPlotParams.js";
import { PANE_DEFAULT_PX } from "./previewPaneLayout.js";
import { plotBlockerFor, PLOT_BLOCKED } from "./previewFacetPlan.js";
import "./styles.css";

// Lazy so the ~1 MB Plotly chunk only downloads when a plot is actually shown.
// It now downloads on the first record opened rather than on the first Plot
// click, since the plot is the default view — but it stays a separate chunk
// behind the Loading fallback below, and the /preview fetch runs alongside it.
const DatasetPreviewPlot = lazy(
  () => import("../DatasetPreviewPlot/DatasetPreviewPlot.jsx"),
);

// What each refusal reads as, and what the axis search was looking for. Two maps
// rather than one message per case in the JSX: the codes are the plan module's
// vocabulary, and this is the only place that turns them into sentences.
const BLOCKED_MESSAGES = {
  [PLOT_BLOCKED.NO_COLUMNS]: "datasetPreviewPlotBlockedNoColumns",
  [PLOT_BLOCKED.UNSUPPORTED_TYPE]: "datasetPreviewPlotBlockedType",
  [PLOT_BLOCKED.NO_SHARED_AXIS]: "datasetPreviewPlotBlockedNoAxis",
  [PLOT_BLOCKED.NO_MEASUREMENTS]: "datasetPreviewPlotBlockedNoMeasurements",
};
const WANTED_LABELS = {
  vertical: "datasetPreviewPlotWantedVertical",
  time: "datasetPreviewPlotWantedTime",
  track: "datasetPreviewPlotWantedTrack",
  measurement: "datasetPreviewPlotWantedMeasurement",
};

const NO_CUSTOM_LABELS = {};
// Never equal to a linkKey (which is a query string, and may be ""), so the
// button starts un-copied and returns there the moment the URL moves on.
const NO_LINK_COPIED = Symbol("no link copied");

export default function DatasetPreview({
  datasetPreview,
  inspectDataset,
  inspectRecordID,
  setInspectRecordID,
  showModal,
  recordLoading,
  setRecordLoading,
}) {
  const { t } = useTranslation();

  // The response arrives as parallel arrays; the table wants row objects. That
  // is a reading of the response, so it is derived rather than copied into
  // state by an effect — which also means there is nothing to clear when the
  // modal closes.
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

  // What is being looked at and how it is drawn — all of it in the query string,
  // so a link reproduces the plot and Back closes it. Each param is written only
  // when it differs from what this dataset type opens on, so an untouched plot
  // adds nothing to the URL. See usePreviewPlotParams.
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
    colorCandidates,
    colorAxis,
    setColorAxis,
    colorScale,
    setColorScale,
    plotType,
    setPlotType,
    uirevision,
    linkKey,
  } = usePreviewPlotParams(inspectDataset, datasetPreview?.table, data);

  // Per-column display names. Lifted out of the plot so they survive the
  // Table/Plot flip (which unmounts it) like everything else now does, but
  // deliberately NOT in the URL: free text is what makes a query string
  // unreadable, and a rename is a private annotation rather than a view.
  const [customLabels, setCustomLabels] = useState(NO_CUSTOM_LABELS);

  // Which URL the Copy button is currently claiming. Held as the copied key
  // rather than a boolean so "still the link they copied?" is derived from the
  // URL instead of re-synced to it: anything that changes the query string —
  // a panel added, the shared axis moved, the map panned behind the modal —
  // makes this stale by definition, with no effect to run and no render where
  // the button claims a link that is no longer there.
  const [copiedLinkKey, setCopiedLinkKey] = useState(NO_LINK_COPIED);
  const linkCopied = copiedLinkKey === linkKey;

  // How wide the plot's parameters pane is. Lifted here for the same reason
  // customLabels is: the plot is unmounted on every Table/Plot flip, and a pane
  // dragged wider has to still be wide on the way back. Not in the URL, and not
  // reset per record — it is a viewing preference like the disclosure triangle
  // in the plot, not a view of the data.
  const [paneWidth, setPaneWidth] = useState(PANE_DEFAULT_PX);

  // The Table view's scroll container, and the CEILING on the plot's height —
  // the plot fills it exactly and scrolls inside its own pane. Measured here
  // because its height is set by the modal (flex, capped at the viewport) and
  // does not move when the plot grows, which is what makes it safe to feed into
  // the plot's height. See useElementSize.
  const [scrollRef, scrollSize] = useElementSize();

  // A different record is a different plot: drop the previous one's names.
  // Adjusted during render rather than from an effect — React discards this
  // render and immediately re-runs with the cleared labels, so the new record
  // never paints under the old record's names the way an effect would let it.
  const [labelledRecordID, setLabelledRecordID] = useState(inspectRecordID);
  if (labelledRecordID !== inspectRecordID) {
    setLabelledRecordID(inspectRecordID);
    setCustomLabels(NO_CUSTOM_LABELS);
  }

  // What stopped this record from being plotted, when nothing else did. Two
  // records of the same cdm_data_type genuinely differ here — one publisher
  // declares the coordinate metadata and the next does not — so the message has
  // to name the missing column rather than blame the type.
  const plotBlocker = useMemo(
    () => (plan ? null : plotBlockerFor(inspectDataset, variables, data)),
    [plan, inspectDataset, variables, data],
  );
  const blockedMessage = (blocker) => {
    if (
      blocker.code === PLOT_BLOCKED.UNSUPPORTED_TYPE &&
      !blocker.cdmDataType
    ) {
      return t("datasetPreviewPlotBlockedNoType");
    }
    return t(BLOCKED_MESSAGES[blocker.code], {
      type: blocker.cdmDataType,
      wanted: blocker.wanted ? t(WANTED_LABELS[blocker.wanted]) : "",
    });
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
            </h4>

            {dataIsReady && (
              // The address bar is already the live mirror of the whole app
              // state — record, plot settings, map and filters — so sharing what
              // is on screen is the current URL and nothing more.
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
                <Loading variant="inline" />
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
                        // The fallback reserves height on purpose: Loading is an
                        // absolutely-positioned scrim contributing none of its
                        // own, so without this the plot mounted into a collapsed
                        // box and Plotly measured it at zero.
                        <Suspense
                          fallback={
                            <div className="datasetPreviewPlotLoading">
                              <Loading variant="inline" />
                            </div>
                          }
                        >
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
                            colorCandidates={colorCandidates}
                            colorAxis={colorAxis}
                            setColorAxis={setColorAxis}
                            colorScale={colorScale}
                            setColorScale={setColorScale}
                            plotType={plotType}
                            setPlotType={setPlotType}
                            customLabels={customLabels}
                            setCustomLabels={setCustomLabels}
                            uirevision={uirevision}
                            availableHeight={scrollSize.height}
                            paneWidth={paneWidth}
                            setPaneWidth={setPaneWidth}
                          />
                        </Suspense>
                      ) : (
                        plotBlocker && (
                          // In the plot's place, saying which column is missing:
                          // the table is still one click away in the header, but
                          // "this type has no layout" was wrong three times out
                          // of four and told nobody what to fix.
                          <div className="datasetPreviewPlotBlocked">
                            <p>{blockedMessage(plotBlocker)}</p>
                            {plotBlocker.columns.length > 0 && (
                              <p className="datasetPreviewPlotBlockedColumns">
                                {t("datasetPreviewPlotBlockedColumns", {
                                  columns: plotBlocker.columns.join(", "),
                                })}
                              </p>
                            )}
                          </div>
                        )
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
