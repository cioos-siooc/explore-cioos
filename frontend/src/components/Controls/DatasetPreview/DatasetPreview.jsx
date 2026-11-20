import * as React from "react";
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Check2,
  GraphUp,
  Link45deg,
  Table as TableIcon,
} from "react-bootstrap-icons";

import Modal from "../../ui/Modal.jsx";
import SegmentedToggle from "../../ui/SegmentedToggle.jsx";
import useElementSize from "../../ui/useElementSize.js";
import useMediaQuery, {
  MOBILE_QUERY,
} from "../../../state/ui/useMediaQuery.js";

import PreviewBody from "./PreviewBody.jsx";
import PreviewPlotProvider from "./PreviewPlotProvider.jsx";
import usePreviewPlotParams from "./usePreviewPlotParams.js";
import usePreviewProfiles from "./usePreviewProfiles.js";
import { previewSampleFor, previewWindowFor } from "./previewSample.js";
import { PANE_DEFAULT_PX } from "./previewPaneLayout.js";
import { DEFAULT_ROW_LIMIT } from "../../../state/selection/previewParams.js";
import "./styles.css";

const NO_CUSTOM_LABELS = {};
const TITLE_ID = "datasetPreviewTitle";
// Never equal to a linkKey (which is a query string, and may be ""), so the
// button starts un-copied and returns there the moment the URL moves on.
const NO_LINK_COPIED = Symbol("no link copied");

export default function DatasetPreview({
  datasetPreview,
  previewError,
  previewQuery,
  retryPreview,
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
      Object.fromEntries(columnNames.map((key, index) => [key, row[index]])),
    );
  }, [datasetPreview]);

  // Plot state lives in the query string so a link reproduces the plot and Back
  // closes it. Only the six the header and the body need are read here; the rest
  // goes to the plot through the provider below.
  const mobile = useMediaQuery(MOBILE_QUERY);
  // Fetched separately from the rows and independent of them: a record whose
  // list fails simply gets no slider.
  const profiles = usePreviewProfiles(
    inspectDataset?.dataset_id,
    inspectRecordID,
  );
  const plotParams = usePreviewPlotParams(
    inspectDataset,
    datasetPreview?.table,
    rows,
    profiles.current,
  );
  const { selectedVis, setSelectedVis, linkKey, step, before, rowLimit } =
    plotParams;

  const drawsOneProfile = Boolean(step || profiles.current);
  // Said beside the title, so the table and the plot both say it.
  const sample = useMemo(
    () =>
      previewSampleFor({
        sample: datasetPreview?.sample,
        rows,
        profiles,
        drawsOneProfile,
      }),
    [datasetPreview, rows, profiles, drawsOneProfile],
  );
  // Shared by the pager above the plot or table and the row count in the
  // parameters pane.
  const previewWindow = useMemo(
    () =>
      previewWindowFor({
        sample: datasetPreview?.sample,
        rows,
        drawsOneProfile,
        hasPeriod: Boolean(inspectRecordPeriod),
        before,
        rowLimitChanged: rowLimit !== DEFAULT_ROW_LIMIT,
      }),
    [
      datasetPreview,
      rows,
      drawsOneProfile,
      inspectRecordPeriod,
      before,
      rowLimit,
    ],
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
  // Two states, not one: the pane beside the plot on larger screens starts
  // shown, the dialog smaller ones open it in starts closed.
  const [paneCollapsed, setPaneCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  // Memoised: a fresh value would re-render every consumer, the plot included,
  // on each render of this modal.
  const plotValue = useMemo(
    () => ({
      ...plotParams,
      inspectDataset,
      inspectRecordID,
      profiles,
      drawnProfileCount: sample?.profileCount ?? null,
      previewWindow,
      customLabels,
      setCustomLabels,
      paneWidth,
      setPaneWidth,
      paneCollapsed,
      setPaneCollapsed,
      settingsOpen,
      setSettingsOpen,
      availableHeight: scrollSize.height,
    }),
    [
      plotParams,
      inspectDataset,
      inspectRecordID,
      profiles,
      sample,
      previewWindow,
      customLabels,
      paneWidth,
      paneCollapsed,
      settingsOpen,
      scrollSize.height,
    ],
  );

  const onModalClose = () => {
    // One call clears ?preview= and every plot param: react-router drops one of
    // two writes made in the same tick (see previewParams.js).
    setInspectRecordID();
    setCustomLabels(NO_CUSTOM_LABELS);
    setRecordLoading(false);
  };
  const dataIsReady = !recordLoading && datasetPreview?.table?.rows;
  // A desktop plot names the record itself (its title, or the heading above a
  // profile), so the header keeps it only for a screen reader there. A phone
  // hides that heading for room, and a table has none.
  const recordNamedBelow = dataIsReady && selectedVis === "plot" && !mobile;

  return (
    <Modal
      className="dataPreviewModal"
      show={showModal}
      size="xl"
      onHide={onModalClose}
      centered
      aria-labelledby={TITLE_ID}
    >
      {inspectDataset && inspectRecordID !== undefined && (
        <PreviewPlotProvider value={plotValue}>
          <Modal.Header closeButton className="tableAndPlotGridContainer">
            {dataIsReady && (
              <SegmentedToggle
                className="previewViewToggle"
                options={[
                  {
                    value: "plot",
                    icon: GraphUp,
                    label: t("datasetPreviewPlotText"),
                  },
                  {
                    value: "table",
                    icon: TableIcon,
                    label: t("datasetPreviewTableText"),
                  },
                ]}
                value={selectedVis}
                onChange={setSelectedVis}
              />
            )}

            <h2 className="datasetTitle" id={TITLE_ID}>
              <span
                className="datasetPreviewDatasetTitle"
                title={inspectDataset.title}
              >
                {inspectDataset.title}
                {inspectRecordID &&
                  (recordNamedBelow ? <span className="sr-only">:</span> : ":")}
              </span>{" "}
              {inspectRecordID && (
                <i
                  className={
                    recordNamedBelow
                      ? "datasetPreviewRecord sr-only"
                      : "datasetPreviewRecord"
                  }
                >
                  {inspectRecordID}
                </i>
              )}
              {inspectRecordPeriod && (
                <span className="datasetPreviewPeriod">
                  {t("datasetPreviewPeriodText", inspectRecordPeriod)}
                </span>
              )}
              {dataIsReady && sample && (
                <span
                  className="datasetPreviewSample"
                  title={t("datasetPreviewSampleHelp", {
                    rows: formatCount(sample.rowCount),
                  })}
                >
                  {t(
                    sample.profileCount === null
                      ? "datasetPreviewSampleRows"
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
            </h2>

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
                previewQuery={previewQuery}
                retryPreview={retryPreview}
              />
            </div>
          </Modal.Body>
        </PreviewPlotProvider>
      )}
    </Modal>
  );
}
