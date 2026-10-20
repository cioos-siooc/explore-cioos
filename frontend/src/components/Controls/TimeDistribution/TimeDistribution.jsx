import React, { Suspense, lazy, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import Spinner from "../../ui/Spinner.jsx";
import { server } from "../../../config";
import reportError from "../../../state/reportError.js";
import "./styles.css";

const CoverageHistogramPlot = lazy(
  () => import("../CoverageHistogramPlot/CoverageHistogramPlot.jsx"),
);

const VIEWS = ["timeline", "seasonal"];

// The dataset's days of data through time, narrowed by the active filters the
// way the map and Coverage figure are: same endpoint, scoped to this dataset.
export default function TimeDistribution({ datasetPk, query }) {
  const { t } = useTranslation();
  const [view, setView] = useState("timeline");
  const [attempt, setAttempt] = useState(0);
  const params = new URLSearchParams(query);
  params.set("datasetPKs", datasetPk);
  params.set("count", "days");
  params.set("view", view);
  const url = `${server}/coverageHistogram?${params.toString()}`;
  // Tagged with the request it answers, so a filter change or a retry reads as
  // loading until its own response lands.
  const request = `${url}#${attempt}`;
  const [result, setResult] = useState({ request: undefined });

  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((histogram) => setResult({ request, histogram }))
      .catch((error) => {
        if (error.name === "AbortError") return;
        reportError("time distribution fetch failed", error);
        setResult({ request, error });
      });
    return () => controller.abort();
  }, [url, request]);

  const loading = result.request !== request;
  // The previous figure stays drawn, dimmed, while the next one loads.
  const histogram = result.histogram;
  const spinner = (
    <div className="timeDistributionStatus">
      <Spinner size="lg" />
    </div>
  );

  let body;
  if (!loading && result.error) {
    body = (
      <div className="cardListEmpty" role="alert">
        {t("coverageErrorMessage")}{" "}
        <button
          type="button"
          className="recordShowAll"
          onClick={() => setAttempt((n) => n + 1)}
        >
          {t("apiErrorRetryButton")}
        </button>
      </div>
    );
  } else if (!histogram) {
    body = spinner;
  } else if (!loading && histogram.cells.length === 0) {
    body = (
      <div className="cardListEmpty">{t("timeDistributionEmptyText")}</div>
    );
  } else {
    body = (
      <div className="timeDistributionPlot" aria-busy={loading || undefined}>
        <Suspense fallback={spinner}>
          <div className={loading ? "timeDistributionStale" : undefined}>
            <CoverageHistogramPlot histogram={histogram} />
          </div>
        </Suspense>
        {loading && spinner}
      </div>
    );
  }

  return (
    <div className="chartSection timeDistribution">
      <div className="recordSectionHeader chartSectionHeader">
        <div>
          <strong>{t("timeDistributionTitle")}</strong>
          <span className="recordHint">{t("timeDistributionHint")}</span>
        </div>
        <div
          className="viewToggle"
          role="group"
          aria-label={t("coverageViewLabel")}
        >
          {VIEWS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
            >
              {t(`coverageView_${option}`)}
            </button>
          ))}
        </div>
      </div>
      {body}
    </div>
  );
}
