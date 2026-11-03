import * as React from "react";
import { Suspense, lazy, useMemo } from "react";
import { useTranslation } from "react-i18next";

import DatasetPreviewTable from "../DatasetPreviewTable/DatasetPreviewTable.jsx";
import { usePreviewPlot } from "./PreviewPlotProvider.jsx";
import { plotBlockerFor, PLOT_BLOCKED } from "./previewFacetPlan.js";
import { PREVIEW_ERROR } from "./previewErrors.js";
import {
  PlotErrorBoundary,
  PreviewFailure,
  PreviewLoading,
} from "./PreviewStatus.jsx";

// Lazy so the ~1 MB Plotly chunk only downloads when a plot is actually shown.
const DatasetPreviewPlot = lazy(
  () => import("../DatasetPreviewPlot/DatasetPreviewPlot.jsx"),
);

// What each refusal reads as, and what the axis search was looking for. The
// codes are the plan module's vocabulary; this is the only place that turns
// them into sentences.
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
// Only the outage suggests trying again — the other three do not get better by
// waiting.
const PREVIEW_ERROR_MESSAGES = {
  [PREVIEW_ERROR.NO_DATA]: "datasetPreviewErrorNoData",
  [PREVIEW_ERROR.ERDDAP_UNAVAILABLE]: "datasetPreviewErrorUnavailable",
  [PREVIEW_ERROR.NO_RECORD_ID_VARIABLE]: "datasetPreviewErrorNoRecordId",
  [PREVIEW_ERROR.RECORD_NOT_FOUND]: "datasetPreviewErrorNotFound",
  [PREVIEW_ERROR.NETWORK]: "datasetPreviewErrorNetwork",
};

// In the plot's place: the table is still one click away in the header, and a
// message naming the missing column beats one blaming the type.
function PlotBlocked({ blocker }) {
  const { t } = useTranslation();
  const message =
    blocker.code === PLOT_BLOCKED.UNSUPPORTED_TYPE && !blocker.cdmDataType
      ? t("datasetPreviewPlotBlockedNoType")
      : t(BLOCKED_MESSAGES[blocker.code], {
          type: blocker.cdmDataType,
          wanted: blocker.wanted ? t(WANTED_LABELS[blocker.wanted]) : "",
        });

  return (
    <div className="datasetPreviewPlotBlocked">
      <p>{message}</p>
      {blocker.columns.length > 0 && (
        <p className="datasetPreviewPlotBlockedColumns">
          {t("datasetPreviewPlotBlockedColumns", {
            columns: blocker.columns.join(", "),
          })}
        </p>
      )}
    </div>
  );
}

/**
 * Which of the five things the modal can be showing: the record is still
 * loading, /preview refused, the table, the plot, or why there is no plot.
 */
export default function PreviewBody({
  recordLoading,
  datasetPreview,
  rows,
  previewError,
  previewQuery,
}) {
  const { t } = useTranslation();
  const {
    selectedVis,
    plan,
    inspectDataset,
    inspectRecordID,
    variables,
    plotData,
    profiles,
  } = usePreviewPlot();

  // Two records of the same cdm_data_type genuinely differ here — one publisher
  // declares the coordinate metadata and the next does not — so the message has
  // to name the missing column rather than blame the type.
  const plotBlocker = useMemo(
    () => (plan ? null : plotBlockerFor(inspectDataset, variables, plotData)),
    [plan, inspectDataset, variables, plotData],
  );

  const profileStep = profiles.pending ? ["previewStepProfiles"] : [];

  if (recordLoading) {
    return (
      <PreviewLoading
        labelKeys={["previewStepRecord", ...profileStep]}
        query={previewQuery}
      />
    );
  }

  if (!datasetPreview?.table?.rows) {
    return (
      <PreviewFailure
        query={previewError?.erddapQuery}
        message={t(
          (previewError && PREVIEW_ERROR_MESSAGES[previewError.code]) ||
            "datasetPreviewNoData",
        )}
        detail={
          previewError &&
          t(
            previewError.upstreamStatus
              ? "datasetPreviewErrorDetailUpstream"
              : "datasetPreviewErrorDetail",
            {
              code: previewError.code,
              status: previewError.upstreamStatus,
            },
          )
        }
      />
    );
  }

  if (selectedVis === "table") {
    return <DatasetPreviewTable datasetPreview={datasetPreview} data={rows} />;
  }

  if (!plan) return plotBlocker ? <PlotBlocked blocker={plotBlocker} /> : null;

  return (
    // Keyed so a failure on one record doesn't stick to the next. The fallback
    // reserves height on purpose: without it the plot mounts into a collapsed
    // box and Plotly measures it at zero.
    <PlotErrorBoundary key={inspectRecordID}>
      <Suspense
        fallback={
          <PreviewLoading labelKeys={["previewStepPlotly", ...profileStep]} />
        }
      >
        <DatasetPreviewPlot />
      </Suspense>
    </PlotErrorBoundary>
  );
}
