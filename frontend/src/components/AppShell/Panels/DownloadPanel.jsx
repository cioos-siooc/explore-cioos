import * as React from "react";
import { useTranslation } from "react-i18next";
import classNames from "classnames";
import isEmpty from "lodash-es/isEmpty";

import DownloadDetails from "../../Controls/DownloadDetails/DownloadDetails.jsx";
import SelectPill from "../../ui/SelectPill.jsx";
import Switch from "../../ui/Switch.jsx";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import {
  PACKAGE_FORMATS,
  useDownload,
} from "../../../state/download/DownloadProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import "./styles.css";

/*
 * The package (CDE builds and mails it, with a size ceiling) and the download
 * script (the same package built on the user's computer, no ceiling) share
 * one selection and format. This panel only owns the email/submit column; the
 * rest is DownloadDetails.
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
    packageFormat,
    setPackageFormat,
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
        {/* Passed as children because the submission state lives in this
            panel's providers; the class places it in the footer's grid. */}
        <div className="downloadFooterSection downloadSubmit">
          <label className="downloadFooterTitle" htmlFor="downloadEmailInput">
            {t("downloadEmailLabelText")}
          </label>
          <SelectPill
            label={t("downloadPackageFormatLabel")}
            value={packageFormat}
            options={PACKAGE_FORMATS.map((id) => ({
              id,
              label: t(`downloadPackageFormat_${id}`),
            }))}
            onChange={setPackageFormat}
            data-testid="download-package-format"
          />
          {["odv", "nccf"].includes(packageFormat) &&
            pointsToDownload.some((point) => point.source_type === "obis") && (
              <p className="downloadEmailNotice">
                {t("downloadPackageFormatObisNote")}
              </p>
            )}
          <div className="downloadSubmitRow">
            <input
              id="downloadEmailInput"
              disabled={submissionState === "submitted"}
              className="emailAddress"
              type="email"
              value={email}
              placeholder={t("downloadEmailPlaceholder")}
              autoComplete="email"
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
            role="status"
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
