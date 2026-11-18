import * as React from "react";
import { useTranslation } from "react-i18next";
import { ArrowClockwise, ExclamationTriangle } from "react-bootstrap-icons";

import ActivityList from "../../ui/ActivityList.jsx";
import Spinner from "../../ui/Spinner.jsx";
import reportError from "../../../state/reportError.js";

// The exact request, opened in a new tab so the reader can see what ERDDAP
// says for themselves.
function ErddapQuery({ url, labelKey = "previewErddapQueryLabel" }) {
  const { t } = useTranslation();
  if (!url) return null;
  return (
    <p className="previewStatusQuery">
      <span>{t(labelKey)}</span>
      <a href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </a>
    </p>
  );
}

// The preview's answer to the app splash: one mark, the waits named beneath it,
// or what went wrong in the same place.
export function PreviewLoading({ labelKeys, query }) {
  return (
    <div className="previewStatus" role="status" data-testid="preview-loading">
      <Spinner size="lg" role="presentation" />
      <ActivityList labelKeys={labelKeys} className="previewStatusSteps" />
      <ErddapQuery url={query} labelKey="previewErddapQueryActiveLabel" />
    </div>
  );
}

export function PreviewFailure({ message, detail, query, onRetry }) {
  const { t } = useTranslation();
  return (
    <div
      className="previewStatus previewStatus-error"
      role="alert"
      data-testid="preview-error"
    >
      <ExclamationTriangle size={40} aria-hidden="true" />
      <p className="previewStatusMessage">{message}</p>
      {detail && <p className="previewStatusDetail">{detail}</p>}
      {onRetry && (
        <button type="button" className="previewStatusRetry" onClick={onRetry}>
          <ArrowClockwise size={14} aria-hidden="true" />
          {t("apiErrorRetryButton")}
        </button>
      )}
      <ErddapQuery url={query} />
    </div>
  );
}

function PlotFailure({ error }) {
  const { t } = useTranslation();
  return (
    <PreviewFailure
      message={t("datasetPreviewErrorPlot")}
      detail={error?.message}
    />
  );
}

// A failed Plotly chunk or a throw while drawing would otherwise reach the app's
// boundary and replace the whole map.
export class PlotErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    reportError("preview plot failed", error);
  }

  render() {
    if (this.state.error) return <PlotFailure error={this.state.error} />;
    return this.props.children;
  }
}
