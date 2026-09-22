import * as React from "react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BarChartLine } from "react-bootstrap-icons";

import Modal from "../../ui/Modal.jsx";
import Spinner from "../../ui/Spinner.jsx";
import { Dropdown, DropdownButton } from "../../ui/Dropdown.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { applyDatasetPKs } from "../../../utilities.jsx";
import { server } from "../../../config.js";
import reportError from "../../../state/reportError.js";
import "./styles.css";

// The Plotly chunk is ~1.4MB, so the histogram only loads once the modal is
// actually opened — same pattern as DatasetPreview.
const CoverageHistogramPlot = lazy(
  () =>
    import("../../Controls/CoverageHistogramPlot/CoverageHistogramPlot.jsx"),
);

// The dimensions the bars can be split (coloured) by. Keys match the API's
// groupBy values.
const GROUP_OPTIONS = ["source", "platform", "dataType", "organization"];

// What the bars count. Keys match the API's `count` values.
const COUNT_OPTIONS = ["datasets", "features", "days"];

// How many past responses to keep. The two dropdowns alone are 12 combinations
// of one selection, and each is a query the API answers in seconds when its
// own cache is cold, so holding them is worth far more than the few kB they
// cost. Bounded because the key includes the dataset list, which changes as
// the map is panned; oldest is evicted first.
const MAX_CACHED_RESPONSES = 20;

// The dataset-coverage figure, launched from the top bar: a histogram of how
// many datasets match the applied filters over time, with the bars split by a
// chosen dimension. Depth is handled by the filter, not drawn as an axis.
export default function CoverageModal() {
  const { t } = useTranslation();
  const { showCoverageModal, setShowCoverageModal } = useUI();
  // The same selection the datasets list shows: the filter query plus the
  // drawn polygon (combinedQueries, what /pointQuery was asked), narrowed to
  // the datasets the list's own client-side filters left standing. Reading
  // the filter query alone is how the figure went on counting datasets the
  // search box, "only in view" and the geometry switches had removed.
  const { combinedQueries, filteredDatasetPks, pointsData } = useSelection();
  const [groupBy, setGroupBy] = useState("source");
  const [count, setCount] = useState("datasets");
  const [histogram, setHistogram] = useState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  // The set the narrowing was made from, so a mild one travels as the datasets
  // it dropped rather than the two thousand it kept (see applyDatasetPKs).
  const allDatasetPks = useMemo(
    () => pointsData.map((row) => row.pk),
    [pointsData],
  );

  // Responses already fetched, keyed by the request that produced them. The
  // modal never unmounts (it is always rendered, visibility is a prop), so
  // this survives closing it — which is the point: reopening the figure, and
  // toggling either dropdown back to a value already looked at, are the two
  // things people do most and both used to pay full price for it.
  const cache = useRef(new Map());

  // Fetch only while the modal is open; refetch when the applied filters or
  // the chosen grouping change so the figure always matches the map + control.
  useEffect(() => {
    if (!showCoverageModal) return undefined;
    const filterString = applyDatasetPKs(
      combinedQueries,
      filteredDatasetPks,
      allDatasetPks,
    );
    const url = `${server}/coverageHistogram?groupBy=${groupBy}&count=${count}&${filterString}`;

    const cached = cache.current.get(url);
    if (cached) {
      setHistogram(cached);
      setError(false);
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(false);
    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        cache.current.set(url, data);
        // Map iterates in insertion order, so the first key is the oldest.
        if (cache.current.size > MAX_CACHED_RESPONSES) {
          cache.current.delete(cache.current.keys().next().value);
        }
        setHistogram(data);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        reportError("coverage histogram fetch failed", err);
        setError(true);
        setLoading(false);
      });
    return () => controller.abort();
  }, [
    showCoverageModal,
    combinedQueries,
    filteredDatasetPks,
    allDatasetPks,
    groupBy,
    count,
  ]);

  const isEmpty = histogram && histogram.cells.length === 0;
  // A refetch over a figure already on screen: keep drawing the old one until
  // the new one lands. An error or an empty result replaces it as before.
  const showStalePlot = Boolean(loading && histogram && !isEmpty);

  return (
    <Modal
      show={showCoverageModal}
      onHide={() => setShowCoverageModal(false)}
      className="coverageModal"
      data-testid="coverage-modal"
      dialogClassName="coverageModalDialog"
      aria-labelledby="coverageModalTitle"
    >
      <Modal.Header closeButton>
        <Modal.Title id="coverageModalTitle">
          <span className="downloadModalTitleIcon" aria-hidden="true">
            <BarChartLine size={20} />
          </span>
          <span className="downloadModalTitleText">
            <span className="downloadModalTitleHeading">
              {t("coverageModalTitleText")}
            </span>
            <span className="downloadModalTitleSubtitle">
              {t("coverageModalSubtitleText")}
            </span>
          </span>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="coverageToolbar">
          <span className="coverageToolbarLabel">
            {t("coverageCountByLabel")}
          </span>
          <DropdownButton
            data-testid="coverage-count-dropdown"
            title={t(`coverageMetric_${count}`)}
          >
            {COUNT_OPTIONS.map((option) => (
              <Dropdown.Item
                key={option}
                data-testid="coverage-count-option"
                active={option === count}
                onClick={() => setCount(option)}
              >
                {t(`coverageMetric_${option}`)}
              </Dropdown.Item>
            ))}
          </DropdownButton>
          <span className="coverageToolbarLabel">
            {t("coverageColorByLabel")}
          </span>
          <DropdownButton
            data-testid="coverage-group-dropdown"
            title={t(`coverageGroup_${groupBy}`)}
          >
            {GROUP_OPTIONS.map((option) => (
              <Dropdown.Item
                key={option}
                data-testid="coverage-group-option"
                active={option === groupBy}
                onClick={() => setGroupBy(option)}
              >
                {t(`coverageGroup_${option}`)}
              </Dropdown.Item>
            ))}
          </DropdownButton>
        </div>
        {/* Organizations are the one multi-valued dimension: a dataset in two
            of them lands in both series, so the stack total is not the
            dataset count. Say so rather than let the axis imply otherwise. */}
        {groupBy === "organization" && (
          <div className="coverageToolbarNote">
            {t("coverageOrganizationNote")}
          </div>
        )}
        {/* Days are per-feature and added up, so a bar measures observation
            effort and routinely exceeds the number of calendar days in its
            period. Deliberately unlike the map's days ramp, which unions. */}
        {count === "days" && (
          <div className="coverageToolbarNote">{t("coverageDaysNote")}</div>
        )}
        <div className="coveragePlotArea">
          {/* A refetch keeps the bars it already has, dimmed, rather than
              blanking to a spinner: switching Count or Colour-by changes one
              facet of the same figure, and these queries take seconds when the
              API's cache is cold. Only the first load, with nothing to show
              yet, gets the full-area spinner. */}
          {loading && !showStalePlot && (
            <div className="coverageModalStatus">
              <Spinner size="lg" />
            </div>
          )}
          {!loading && error && (
            <div className="coverageModalStatus">
              {t("coverageErrorMessage")}
            </div>
          )}
          {!loading && !error && isEmpty && (
            <div className="coverageModalStatus">
              {t("coverageEmptyMessage")}
            </div>
          )}
          {(showStalePlot || (!loading && !error && histogram && !isEmpty)) && (
            <Suspense
              fallback={
                <div className="coverageModalStatus">
                  <Spinner size="lg" />
                </div>
              }
            >
              <div
                className={
                  loading ? "coveragePlotStale" : "coveragePlotCurrent"
                }
                aria-busy={loading || undefined}
              >
                <CoverageHistogramPlot histogram={histogram} />
              </div>
            </Suspense>
          )}
          {showStalePlot && (
            <div className="coveragePlotBusy">
              <Spinner size="sm" />
            </div>
          )}
        </div>
      </Modal.Body>
    </Modal>
  );
}
