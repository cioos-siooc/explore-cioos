import * as React from "react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import classNames from "classnames";
import isEmpty from "lodash-es/isEmpty";

import DownloadDetails from "../../Controls/DownloadDetails/DownloadDetails.jsx";
import DownloadExports from "../../Controls/DownloadDetails/DownloadExports.jsx";
import DownloadFormats from "../../Controls/DownloadDetails/DownloadFormats.jsx";
import FilterDownloadToggles from "../../Controls/DownloadDetails/FilterDownloadToggles.jsx";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { useDownload } from "../../../state/download/DownloadProvider.jsx";
import {
  buildDownloadLinks,
  defaultErddapFormat,
  defaultObisFormat,
  downloadConstraints,
} from "../../../downloadLinks.js";
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
 * The page is a band of settings (which filters apply, what format the links
 * return), the list they both answer to, and an order bar: totals, the email
 * the archive goes to, and the links as a file.
 */
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

  const [erddapFormat, setErddapFormat] = useState(defaultErddapFormat);
  const [obisFormat, setObisFormat] = useState(defaultObisFormat);

  const constraints = useMemo(
    () =>
      downloadConstraints({
        query,
        polygon,
        byTime: filterDownloadByTime,
        byDepth: filterDownloadByDepth,
        byPolygon: filterDownloadByPolygon,
      }),
    [
      query,
      polygon,
      filterDownloadByTime,
      filterDownloadByDepth,
      filterDownloadByPolygon,
    ],
  );

  // Built from the whole selection rather than from the ticked subset: the
  // ticks are the packager's business (see DownloadExports), and every dataset
  // that can be linked to gets its link.
  const links = useMemo(
    () =>
      buildDownloadLinks(
        pointsToReview,
        { erddapFormat, obisFormat },
        constraints,
      ),
    [pointsToReview, erddapFormat, obisFormat, constraints],
  );
  const linksByPk = useMemo(
    () => new Map(links.map((link) => [link.pk, link])),
    [links],
  );

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
      {/* One row of chrome: what the order narrows by, and what its links
          return. Every row spent here is a row of datasets the list below
          does not show. */}
      <div className="downloadBandRow">
        <FilterDownloadToggles
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
        />
        <DownloadFormats
          links={links}
          erddapFormat={erddapFormat}
          setErddapFormat={setErddapFormat}
          obisFormat={obisFormat}
          setObisFormat={setObisFormat}
        />
      </div>

      <DownloadDetails
        pointsToReview={pointsToReview}
        setPointsToDownload={setPointsToDownload}
        setHoveredDataset={setHoveredDataset}
        linksByPk={linksByPk}
        query={query}
        polygon={polygon}
        filterDownloadByTime={filterDownloadByTime}
        filterDownloadByDepth={filterDownloadByDepth}
        filterDownloadByPolygon={filterDownloadByPolygon}
        setSubmissionState={setSubmissionState}
      >
        <div className="downloadSubmit">
          <label className="downloadSubmitLabel" htmlFor="downloadEmailInput">
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

        <DownloadExports links={links} constraints={constraints} />
      </DownloadDetails>
    </div>
  );
}
