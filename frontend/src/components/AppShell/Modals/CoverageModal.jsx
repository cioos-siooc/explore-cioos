import * as React from "react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
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

  // Fetch only while the modal is open; refetch when the applied filters or
  // the chosen grouping change so the figure always matches the map + control.
  useEffect(() => {
    if (!showCoverageModal) return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(false);
    const filterString = applyDatasetPKs(
      combinedQueries,
      filteredDatasetPks,
      allDatasetPks,
    );
    fetch(
      `${server}/coverageHistogram?groupBy=${groupBy}&count=${count}&${filterString}`,
      { signal: controller.signal },
    )
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
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

  return (
    <Modal
      show={showCoverageModal}
      onHide={() => setShowCoverageModal(false)}
      className="coverageModal"
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
          <DropdownButton title={t(`coverageMetric_${count}`)}>
            {COUNT_OPTIONS.map((option) => (
              <Dropdown.Item
                key={option}
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
          <DropdownButton title={t(`coverageGroup_${groupBy}`)}>
            {GROUP_OPTIONS.map((option) => (
              <Dropdown.Item
                key={option}
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
          {loading && (
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
          {!loading && !error && histogram && !isEmpty && (
            <Suspense
              fallback={
                <div className="coverageModalStatus">
                  <Spinner size="lg" />
                </div>
              }
            >
              <CoverageHistogramPlot histogram={histogram} />
            </Suspense>
          )}
        </div>
      </Modal.Body>
    </Modal>
  );
}
