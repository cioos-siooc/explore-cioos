import * as React from "react";
import { useTranslation } from "react-i18next";
import classNames from "classnames";
import isEmpty from "lodash-es/isEmpty";

import DownloadDetails from "../../Controls/DownloadDetails/DownloadDetails.jsx";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { useDownload } from "../../../state/download/DownloadProvider.jsx";
import "./styles.css";

// The Download panel: order review (DownloadDetails) + email submit.
export default function DownloadPanel() {
  const { t } = useTranslation();
  const { query, timeFilterActive, depthFilterActive } = useFilters();
  const {
    polygon,
    pointsToReview,
    pointsToDownload,
    setPointsToDownload,
    setHoveredDataset,
  } = useSelection();
  const {
    email,
    emailValid,
    submissionState,
    setSubmissionState,
    submissionFeedback,
    filterDownloadByTime,
    setFilterDownloadByTime,
    filterDownloadByDepth,
    setFilterDownloadByDepth,
    filterDownloadByPolygon,
    setFilterDownloadByPolygon,
    polygonFilterActive,
    handleEmailChange,
    handleSubmission,
  } = useDownload();

  if (isEmpty(pointsToReview)) {
    return (
      <div
        className="downloadPanel downloadPanelEmpty"
        data-testid="download-panel"
      >
        {t("dockDownloadEmptyMessage")}
      </div>
    );
  }

  return (
    <div className="downloadPanel" data-testid="download-panel">
      <DownloadDetails
        width={650}
        pointsToReview={pointsToReview}
        setPointsToDownload={setPointsToDownload}
        setHoveredDataset={setHoveredDataset}
        polygon={polygon}
        query={query}
        timeFilterActive={timeFilterActive}
        filterDownloadByTime={filterDownloadByTime}
        setFilterDownloadByTime={setFilterDownloadByTime}
        depthFilterActive={depthFilterActive}
        filterDownloadByDepth={filterDownloadByDepth}
        setFilterDownloadByDepth={setFilterDownloadByDepth}
        polygonFilterActive={polygonFilterActive}
        filterDownloadByPolygon={filterDownloadByPolygon}
        setFilterDownloadByPolygon={setFilterDownloadByPolygon}
        setSubmissionState={setSubmissionState}
      >
        {/* The queue column of DownloadDetails' order footer. Passed as
            children rather than rendered there because the submission state it
            drives lives in this panel's providers; the class is what places it
            in the footer's grid, beside the summary and the direct links. */}
        <div className="downloadFooterSection downloadSubmit">
          <label className="downloadFooterTitle" htmlFor="downloadEmailInput">
            {t("downloadEmailLabelText")}
          </label>
          <div className="downloadSubmitRow">
            <input
              id="downloadEmailInput"
              disabled={submissionState === "submitted"}
              className="emailAddress"
              type="email"
              value={email}
              placeholder="email@email.com"
              aria-label="Email"
              onInput={(e) => handleEmailChange(e.target.value)}
            />
            <button
              className={classNames("submitRequestButton", {
                disabled:
                  !emailValid ||
                  isEmpty(pointsToDownload) ||
                  submissionState === "submitted",
              })}
              disabled={
                !emailValid ||
                isEmpty(pointsToDownload) ||
                submissionState === "submitted"
              }
              onClick={() => handleSubmission()}
            >
              {(!isEmpty(pointsToDownload) &&
                submissionFeedback &&
                submissionState !== "submitted" &&
                t("submitRequestButtonResubmitText")) ||
                (isEmpty(pointsToDownload) &&
                  t("submitRequestButtonSelectDataText")) ||
                t("submitRequestButtonSubmitText")}
            </button>
          </div>
          <div
            className={classNames("submissionFeedback", {
              success: submissionState === "successful",
              error: submissionState === "failed",
            })}
          >
            {submissionFeedback && (
              <>
                {submissionFeedback.icon}
                {submissionFeedback.text}
              </>
            )}
          </div>
        </div>
      </DownloadDetails>
    </div>
  );
}
