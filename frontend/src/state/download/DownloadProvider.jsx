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
  createDataFilterQueryString,
  validateEmail,
  getCookieValue,
  useChanged,
} from "../../utilities.jsx";
import { useFilters } from "../filters/FilterProvider.jsx";
import { useSelection } from "../selection/SelectionProvider.jsx";

const DownloadContext = createContext();

// Remember the address for a month so the next download does not have to be
// retyped. Read back by getCookieValue when the provider mounts.
function rememberEmail(email) {
  document.cookie = `email=${email}; Secure; max-age=${60 * 60 * 24 * 31}`;
}

export function useDownload() {
  return useContext(DownloadContext);
}

export default function DownloadProvider({ children }) {
  const { t, i18n } = useTranslation();
  const { query, startDate, endDate, startDepth, endDepth } = useFilters();
  const { polygon, pointsToDownload } = useSelection();

  const [email, setEmail] = useState(getCookieValue("email"));
  const [submissionState, setSubmissionState] = useState();

  // Whether each filter is carried into the download. These are checkboxes the
  // user owns, so they are state — but they start out matching the filters that
  // are actually doing something, and go back to matching them whenever those
  // change (see the reset below).
  const [filterDownloadByTime, setFilterDownloadByTime] = useState(false);
  const [filterDownloadByDepth, setFilterDownloadByDepth] = useState(false);
  const [filterDownloadByPolygon, setFilterDownloadByPolygon] = useState(false);

  const emailValid = validateEmail(email);
  const polygonFilterActive = !isEmpty(polygon);

  // Re-seeding the checkboxes when the filters move is React's "adjust state
  // when an input changes" — done during render against the previous value
  // rather than in an effect, so the panel never paints one frame with the
  // previous filters' boxes ticked. `query` carries the debounced filter
  // values, so comparing it is the same test the boxes are seeded from.
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

  // Emptying the selection retires whatever the last submission said about it.
  // The submit button is disabled while the selection is empty either way, so
  // this only clears the message.
  if (useChanged(pointsToDownload) && isEmpty(pointsToDownload)) {
    setSubmissionState(undefined);
  }

  // What the panel shows under the submit button — a pure reading of the
  // submission state, so it is derived here rather than pushed into a second
  // piece of state that has to be kept in step with the first.
  const submissionFeedback = useMemo(() => {
    switch (submissionState) {
      case "submitted":
        return {
          icon: <Spinner size="sm" className="submissionSpinner" />,
          text: t("submissionStateTextSubmitting"), // 'Submitting...'
        };
      case "successful":
        return {
          icon: <Check2Circle size={18} className="success" />,
          text: t("submissionStateTextSuccess"), // Request successful. Download link will be sent to: ' + email
        };
      case "failed":
        return {
          icon: <XCircle size={18} className="error" />,
          text: t("submissionStateTextFailed"), // 'Request failed'
        };
      default:
        return undefined;
    }
  }, [submissionState, t]);

  function handleEmailChange(value) {
    setEmail(value);
    // Editing the address retracts the previous attempt's verdict: it was
    // about a different recipient.
    setSubmissionState(undefined);
  }

  function handleSubmission() {
    setSubmissionState("submitted");
    if (validateEmail(email)) rememberEmail(email);
    // Submitting is what the click does, so it happens here rather than in an
    // effect watching for the state to become "submitted".
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
    let url = `${server}/download?${createDataFilterQueryString(
      downloadQuery,
    )}&datasetPKs=${pointsToDownload
      .map((point) => point.pk)
      .join(",")}&email=${email}&lang=${i18n.language}`;
    if (polygon && filterDownloadByPolygon) {
      url += `&polygon=${JSON.stringify(polygon)}`;
    }
    fetch(url)
      .then((response) => {
        if (response.ok) {
          setSubmissionState("successful");
        } else {
          setSubmissionState("failed");
        }
      })
      .catch((error) => {
        setSubmissionState("failed");
        reportError("download submission failed", error);
      });
  }

  const value = {
    email,
    setEmail,
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
  };

  return (
    <DownloadContext.Provider value={value}>
      {children}
    </DownloadContext.Provider>
  );
}
