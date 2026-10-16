import * as React from "react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChartLine,
  ExclamationCircle,
  InfoCircle,
} from "react-bootstrap-icons";

import Modal from "../../ui/Modal.jsx";
import Skeleton, { SkeletonGroup } from "../../ui/Skeleton.jsx";
import Spinner from "../../ui/Spinner.jsx";
import { Dropdown, DropdownButton } from "../../ui/Dropdown.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { applyDatasetPKs } from "../../../utilities.jsx";
import { server } from "../../../config.js";
import reportError from "../../../state/reportError.js";
import "./styles.css";

// The Plotly chunk is ~1.4MB, so it loads only once the modal is opened.
const CoverageHistogramPlot = lazy(
  () =>
    import("../../Controls/CoverageHistogramPlot/CoverageHistogramPlot.jsx"),
);

// Keys match the API's groupBy values.
const GROUP_OPTIONS = ["source", "platform", "dataType", "organization"];

// What the bars count. Keys match the API's `count` values.
const COUNT_OPTIONS = ["datasets", "features", "days"];

// Keys match the API's `view` values and the ?coverageAxis= link param.
const VIEW_OPTIONS = ["timeline", "seasonal"];

// Each combination costs seconds on a cold API cache, so holding them is worth
// the few kB. Bounded because the key includes the dataset list, which changes
// as the map is panned.
const MAX_CACHED_RESPONSES = 20;

// The usual shape of the record, as (position, height %) control points.
const SKELETON_CURVE = [
  [0, 0],
  [0.12, 0],
  [0.13, 2],
  [0.2, 3],
  [0.23, 5],
  [0.28, 10],
  [0.45, 10],
  [0.55, 15],
  [0.6, 22],
  [0.72, 32],
  [0.8, 45],
  [0.88, 62],
  [0.95, 100],
  [0.98, 50],
  [1, 22],
];
const SKELETON_BAR_COUNT = 120;
const SKELETON_BAR_HEIGHTS = Array.from(
  { length: SKELETON_BAR_COUNT },
  (_, i) => {
    const x = i / (SKELETON_BAR_COUNT - 1);
    const k = SKELETON_CURVE.findIndex(([at]) => at >= x);
    const [x1, y1] = SKELETON_CURVE[Math.max(k - 1, 0)];
    const [x2, y2] = SKELETON_CURVE[k];
    const y = x2 === x1 ? y2 : y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
    // Fixed jitter so neighbouring bars differ like real ones do.
    const jitter = 1 + 0.12 * Math.sin(i * 2.7);
    return Math.min(100, y * jitter);
  },
);
const histogramSkeleton = (
  <SkeletonGroup className="coverageSkeleton">
    <div className="coverageSkeletonLegend">
      {[70, 90, 55, 75, 60].map((width, i) => (
        <div key={i} className="coverageSkeletonLegendRow">
          <Skeleton width="12px" height="12px" radius="2px" />
          <Skeleton width={`${width}%`} />
        </div>
      ))}
    </div>
    <div className="coverageSkeletonBars">
      {SKELETON_BAR_HEIGHTS.map((height, i) => (
        <Skeleton key={i} height={`${height}%`} radius="0" />
      ))}
    </div>
    {/* Bars alone would read as a finished figure that failed to draw. The
        group is the status, so the mark is decoration. */}
    <div className="coverageModalStatus coveragePlotBusy">
      <Spinner size="lg" role="presentation" />
    </div>
  </SkeletonGroup>
);

function CoverageOption({ label, help }) {
  return (
    <span className="coverageOption">
      <span className="coverageOptionLabel">{label}</span>
      <span className="coverageOptionHelp">{help}</span>
    </span>
  );
}

// Depth is handled by the filter, not drawn as an axis.
export default function CoverageModal() {
  const { t } = useTranslation();
  const {
    showCoverageModal,
    setShowCoverageModal,
    coverageAxis: view,
    setCoverageAxis: setView,
  } = useUI();
  // Narrowed to what the list's client-side filters left, or the figure would
  // count datasets the search, "only in view" and geometry switches removed.
  const { combinedQueries, filteredDatasetPks, pointsData } = useSelection();
  const [groupBy, setGroupBy] = useState("source");
  const [count, setCount] = useState("days");
  const [histogram, setHistogram] = useState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  // So a mild narrowing travels as the datasets it dropped rather than the
  // thousands it kept (see applyDatasetPKs).
  const allDatasetPks = useMemo(
    () => pointsData.map((row) => row.pk),
    [pointsData],
  );

  // The modal never unmounts, so this survives closing it: reopening and
  // toggling back to a seen value are the most common actions.
  const cache = useRef(new Map());

  useEffect(() => {
    if (!showCoverageModal) return undefined;
    const filterString = applyDatasetPKs(
      combinedQueries,
      filteredDatasetPks,
      allDatasetPks,
    );
    const url = `${server}/coverageHistogram?groupBy=${groupBy}&count=${count}&view=${view}&${filterString}`;

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
    view,
  ]);

  const isEmpty = histogram && histogram.cells.length === 0;
  // Keep drawing the old figure until the new one lands.
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
          <div className="coverageToolbarNotes">
            {/* A dataset in two organizations lands in both series, so the
                stack total is not the dataset count. */}
            {groupBy === "organization" && (
              <div className="coverageToolbarNote">
                <InfoCircle aria-hidden="true" />
                {t("coverageOrganizationNote")}
              </div>
            )}
            {/* Days are summed per feature (observation effort), unlike the
                map's days ramp, which unions. */}
            {count === "days" && (
              <div className="coverageToolbarNote">
                <InfoCircle aria-hidden="true" />
                {t("coverageDaysNote")}
              </div>
            )}
            {view === "seasonal" && (
              <div className="coverageToolbarNote">
                <InfoCircle aria-hidden="true" />
                {t("coverageSeasonalNote")}
              </div>
            )}
          </div>
          <div className="coverageToolbarControls">
            <span className="coverageToolbarLabel">
              {t("coverageViewLabel")}
            </span>
            <DropdownButton
              data-testid="coverage-view-dropdown"
              title={t(`coverageView_${view}`)}
              menuClassName="coverageOptionMenu"
              align="end"
            >
              {VIEW_OPTIONS.map((option) => (
                <Dropdown.Item
                  key={option}
                  data-testid="coverage-view-option"
                  active={option === view}
                  onClick={() => setView(option)}
                >
                  <CoverageOption
                    label={t(`coverageView_${option}`)}
                    help={t(`coverageViewHelp_${option}`)}
                  />
                </Dropdown.Item>
              ))}
            </DropdownButton>
            <span className="coverageToolbarLabel">
              {t("coverageCountByLabel")}
            </span>
            <DropdownButton
              data-testid="coverage-count-dropdown"
              title={t(`coverageMetric_${count}`)}
              menuClassName="coverageOptionMenu"
              align="end"
            >
              {COUNT_OPTIONS.map((option) => (
                <Dropdown.Item
                  key={option}
                  data-testid="coverage-count-option"
                  active={option === count}
                  onClick={() => setCount(option)}
                >
                  <CoverageOption
                    label={t(`coverageMetric_${option}`)}
                    help={t(`coverageMetricHelp_${option}`)}
                  />
                </Dropdown.Item>
              ))}
            </DropdownButton>
            <span className="coverageToolbarLabel">
              {t("coverageColorByLabel")}
            </span>
            <DropdownButton
              data-testid="coverage-group-dropdown"
              title={t(`coverageGroup_${groupBy}`)}
              menuClassName="coverageOptionMenu"
              align="end"
            >
              {GROUP_OPTIONS.map((option) => (
                <Dropdown.Item
                  key={option}
                  data-testid="coverage-group-option"
                  active={option === groupBy}
                  onClick={() => setGroupBy(option)}
                >
                  <CoverageOption
                    label={t(`coverageGroup_${option}`)}
                    help={t(`coverageGroupHelp_${option}`)}
                  />
                </Dropdown.Item>
              ))}
            </DropdownButton>
          </div>
        </div>
        <div className="coveragePlotArea">
          {/* A refetch keeps the old bars, dimmed: these queries take seconds
              on a cold cache. */}
          {loading && !showStalePlot && histogramSkeleton}
          {!loading && error && (
            <div className="coverageModalStatus coverageModalError">
              <ExclamationCircle aria-hidden="true" />
              {t("coverageErrorMessage")}
            </div>
          )}
          {!loading && !error && isEmpty && (
            <div className="coverageModalStatus">
              {t("coverageEmptyMessage")}
            </div>
          )}
          {(showStalePlot || (!loading && !error && histogram && !isEmpty)) && (
            <Suspense fallback={histogramSkeleton}>
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
            <div className="coverageModalStatus coveragePlotBusy">
              <Spinner size="lg" />
            </div>
          )}
        </div>
      </Modal.Body>
    </Modal>
  );
}
