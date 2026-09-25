import * as React from "react";
import { useTranslation } from "react-i18next";
import classNames from "classnames";
import isEmpty from "lodash-es/isEmpty";

import DownloadDetails from "../../Controls/DownloadDetails/DownloadDetails.jsx";
import Switch from "../../ui/Switch.jsx";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { useDownload } from "../../../state/download/DownloadProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import "./styles.css";

/*
 * The Download panel: one page for one order.
 *
 * There are two ways to take a selection away, and they are aspects of each
 * dataset rather than two destinations to choose between:
 *
 *  - Prepared — the CDE packages the ticked datasets and mails a link. One
 *    archive, uniform variables, and a per-dataset size ceiling it refuses to
 *    exceed.
 *  - Direct — the URL of the dataset on the server that publishes it, in a
 *    format of the user's choosing. No ceiling, no wait, no CDE in the middle.
 *
 * They used to be two tabs, which meant the same datasets listed twice and the
 * ceiling on one tab explained by a link on the other. Now each card carries
 * both: its size, whether the packager will take it, and its own URL — so the
 * dataset the archive refuses is the one showing you how to fetch it anyway.
 *
 * The band of settings (which filters apply, what format the links return)
 * and the direct-link machinery live in DownloadDetails, which also hands the
 * list its own toolbar picker — this panel only owns the queue's email/submit
 * column.
 */
export default function DownloadPanel() {
  const { t } = useTranslation();
  const { setShowPrivacyModal } = useUI();
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
    rememberEmail,
    setRememberEmail,
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
        pointsToReview={pointsToReview}
        setPointsToDownload={setPointsToDownload}
        setHoveredDataset={setHoveredDataset}
        query={query}
        polygon={polygon}
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
          <Switch
            id="downloadRememberEmail"
            label={t("downloadRememberEmailLabel")}
            checked={rememberEmail}
            onChange={() => setRememberEmail(!rememberEmail)}
          />
          <p className="downloadEmailNotice">
            {t("downloadEmailNotice")}{" "}
            <button
              type="button"
              className="downloadEmailNoticeLink"
              onClick={() => setShowPrivacyModal(true)}
            >
              {t("privacyLinkText")}
            </button>
          </p>
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
