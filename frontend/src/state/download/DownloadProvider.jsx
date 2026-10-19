import * as React from "react";
import { createContext, useContext, useState, useMemo } from "react";
import { Check2Circle, XCircle } from "react-bootstrap-icons";
import Spinner from "../../components/ui/Spinner.jsx";
import { useTranslation } from "react-i18next";
import isEmpty from "lodash-es/isEmpty";

import { server } from "../../config.js";
import reportError from "../reportError.js";
import {
  defaultStartDate,
  defaultEndDate,
  defaultStartDepth,
  defaultEndDepth,
} from "../../components/config.js";
import {
  applyDatasetPKs,
  createDataFilterQueryString,
  validateEmail,
  useChanged,
} from "../../utilities.jsx";
import { useFilters } from "../filters/FilterProvider.jsx";
import { useSelection } from "../selection/SelectionProvider.jsx";
import { usePersistentState } from "../usePersistentState.js";

const DownloadContext = createContext();

const FAILURE_TEXT_KEYS = {
  network: "submissionStateTextFailedNetwork",
  rejected: "submissionStateTextFailedRejected",
  server: "submissionStateTextFailedServer",
};

export function useDownload() {
  return useContext(DownloadContext);
}

export default function DownloadProvider({ children }) {
  const { t, i18n } = useTranslation();
  const { query, startDate, endDate, startDepth, endDepth } = useFilters();
  const { polygon, pointsToDownload } = useSelection();

  const [savedEmail, setSavedEmail] = usePersistentState("email", "");
  const [email, setEmail] = useState(savedEmail);
  const [rememberEmail, setRememberEmailState] = useState(Boolean(savedEmail));
  const [submissionState, setSubmissionState] = useState();
  const [failureReason, setFailureReason] = useState();

  // User-owned checkboxes, re-seeded to match the active filters whenever
  // those change (see below).
  const [filterDownloadByTime, setFilterDownloadByTime] = useState(false);
  const [filterDownloadByDepth, setFilterDownloadByDepth] = useState(false);
  const [filterDownloadByPolygon, setFilterDownloadByPolygon] = useState(false);

  const emailValid = validateEmail(email);
  const polygonFilterActive = !isEmpty(polygon);

  // During render, not in an effect, so the panel never paints a frame with
  // the previous filters' boxes ticked.
  if (useChanged(query)) {
    setFilterDownloadByTime(
      query.startDate !== defaultStartDate || query.endDate !== defaultEndDate,
    );
    setFilterDownloadByDepth(
      query.startDepth !== defaultStartDepth ||
        query.endDepth !== defaultEndDepth,
    );
  }

  if (useChanged(polygon)) setFilterDownloadByPolygon(polygonFilterActive);

  // The submit button is already disabled while empty; this clears the message.
  if (useChanged(pointsToDownload) && isEmpty(pointsToDownload)) {
    setSubmissionState(undefined);
  }

  const submissionFeedback = useMemo(() => {
    switch (submissionState) {
      case "submitted":
        return {
          icon: <Spinner size="sm" className="submissionSpinner" />,
          text: t("submissionStateTextSubmitting"),
        };
      case "successful":
        return {
          icon: <Check2Circle size={18} className="success" />,
          text: t("submissionStateTextSuccess", { email }),
        };
      case "failed":
        return {
          icon: <XCircle size={18} className="error" />,
          text: t(FAILURE_TEXT_KEYS[failureReason]),
        };
      default:
        return undefined;
    }
  }, [submissionState, failureReason, email, t]);

  function handleEmailChange(value) {
    setEmail(value);
    // The previous verdict was about a different recipient.
    setSubmissionState(undefined);
  }

  function setRememberEmail(remember) {
    setRememberEmailState(remember);
    if (!remember) setSavedEmail("");
  }

  function handleSubmission() {
    setSubmissionState("submitted");
    if (rememberEmail && validateEmail(email)) setSavedEmail(email);
    // Cookieless and anonymous (see PrivacyModal). Absent when the script is
    // blocked or has not loaded, which only costs the count.
    window.plausible?.("Download submitted", {
      props: {
        datasets: String(pointsToDownload.length),
        language: i18n.language,
      },
    });
    // Here rather than in an effect watching for "submitted".
    submitRequest();
  }

  function submitRequest() {
    const downloadQuery = { ...query };
    if (
      (startDate !== defaultStartDate || endDate !== defaultEndDate) &&
      !filterDownloadByTime
    ) {
      downloadQuery.startDate = defaultStartDate;
      downloadQuery.endDate = defaultEndDate;
    }
    if (
      (startDepth !== defaultStartDepth || endDepth !== defaultEndDepth) &&
      !filterDownloadByDepth
    ) {
      downloadQuery.startDepth = defaultStartDepth;
      downloadQuery.endDepth = defaultEndDepth;
    }
    // A Datasets filter already writes datasetPKs; applyDatasetPKs replaces it,
    // because a repeated key reaches the API as an array and 500s.
    let url = `${server}/download?${applyDatasetPKs(
      createDataFilterQueryString(downloadQuery),
      pointsToDownload.map((point) => point.pk),
    )}&lang=${i18n.language}`;
    if (polygon && filterDownloadByPolygon) {
      url += `&polygon=${JSON.stringify(polygon)}`;
    }
    // The address goes in the body: a URL is written to access logs and
    // recorded by Sentry's request tracing, and a body is not.
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    })
      .then((response) => {
        if (response.ok) {
          setSubmissionState("successful");
        } else {
          setFailureReason(response.status < 500 ? "rejected" : "server");
          setSubmissionState("failed");
        }
      })
      .catch((error) => {
        setFailureReason("network");
        setSubmissionState("failed");
        reportError("download submission failed", error);
      });
  }

  const value = {
    email,
    setEmail,
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
  };

  return (
    <DownloadContext.Provider value={value}>
      {children}
    </DownloadContext.Provider>
  );
}
