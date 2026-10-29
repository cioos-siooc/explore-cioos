import * as React from "react";
import { useMemo, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import isEmpty from "lodash-es/isEmpty";

import DatasetsTable from "../DatasetsTable/DatasetsTable.jsx";
import DownloadFormat from "./DownloadFormat.jsx";
import DownloadLinks from "./DownloadLinks.jsx";
import FilterDownloadToggles from "./FilterDownloadToggles.jsx";

import { useActivityTask } from "../../../state/activity/ActivityProvider.jsx";
import {
  OBIS_FORMATS,
  useDownload,
} from "../../../state/download/DownloadProvider.jsx";

import {
  applyDatasetPKs,
  createDataFilterQueryString,
  formatSizeEstimate,
  useChanged,
  sumSizeEstimates,
} from "../../../utilities.jsx";
import {
  defaultEndDate,
  defaultEndDepth,
  defaultStartDate,
  defaultStartDepth,
} from "../../config.js";
import { server } from "../../../config.js";
import {
  buildDownloadLinks,
  downloadConstraints,
} from "../../../downloadLinks.js";
import reportError from "../../../state/reportError.js";
import "./styles.css";
import Spinner from "../../ui/Spinner.jsx";

// Note: datasets and points are interchangeable terminology here.
export default function DownloadDetails({
  pointsToReview,
  setPointsToDownload,
  setHoveredDataset,
  polygon,
  query,
  timeFilterActive,
  filterDownloadByTime,
  setFilterDownloadByTime,
  depthFilterActive,
  filterDownloadByDepth,
  setFilterDownloadByDepth,
  polygonFilterActive,
  filterDownloadByPolygon,
  setFilterDownloadByPolygon,
  setSubmissionState,
  children,
}) {
  const { t } = useTranslation();
  const { packageFormat } = useDownload();
  const [selectAll, setSelectAll] = useState(true);
  const [pointsData, setPointsData] = useState(
    pointsToReview
      // Griddap is metadata-only and must never reach the estimate/queue flow.
      .filter((ptr) => ptr.cdm_data_type !== "Grid")
      .map((ptr) => {
        return { ...ptr, downloadDisabled: false };
      }),
  );
  // Pruned rather than re-seeded, so the rows left keep their estimates and
  // batch ticks.
  const reviewPks = pointsToReview.map((ptr) => ptr.pk).join(",");
  if (useChanged(reviewPks)) {
    const livePks = new Set(pointsToReview.map((ptr) => ptr.pk));
    setPointsData(pointsData.filter((point) => livePks.has(point.pk)));
  }
  const [dataTotal, setDataTotal] = useState(0);
  const [downloadSizeEstimates, setDownloadSizeEstimates] = useState();
  // Failed is a third state: no sizes, but no spinner either.
  const [estimatesLoading, setEstimatesLoading] = useState(true);
  useActivityTask("activityEstimatesText", estimatesLoading);

  // The three effects below are a pipeline (fetch estimates -> merge into
  // pointsData -> totals + basket) whose dependency arrays are deliberately
  // short: listing `pointsData` would feed the pipeline its own output, and
  // listing `downloadSizeEstimates` in the third would run it on pre-merge rows.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEstimatesLoading(true);
    setDownloadSizeEstimates();

    const datasetPKs = pointsData.map((ds) => ds.pk);
    // A Datasets filter already writes datasetPKs; applyDatasetPKs replaces it,
    // because a repeated key reaches the API as an array and 500s.
    const estimateUrl = (filterQuery) =>
      `${server}/downloadEstimate?${applyDatasetPKs(filterQuery, datasetPKs)}`;
    const unfilteredUrl = estimateUrl("");
    const isFiltered =
      filterDownloadByPolygon || filterDownloadByTime || filterDownloadByDepth;
    let filteredUrl = unfilteredUrl;
    if (isFiltered) {
      let filterQuery = "";
      if (query) {
        const tempQuery = { ...query };
        if (!filterDownloadByTime) {
          tempQuery.startDate = defaultStartDate;
          tempQuery.endDate = defaultEndDate;
        }
        if (!filterDownloadByDepth) {
          tempQuery.startDepth = defaultStartDepth;
          tempQuery.endDepth = defaultEndDepth;
        }
        filterQuery = createDataFilterQueryString(tempQuery);
      }
      filteredUrl = estimateUrl(filterQuery);
      if (polygon && filterDownloadByPolygon) {
        filteredUrl += `&polygon=${JSON.stringify(polygon)}`;
      }
    }

    const fetchEstimates = (url) =>
      fetch(url).then((response) => {
        if (!response.ok) {
          throw new Error(`downloadEstimate failed: ${response.status}`);
        }
        return response.json();
      });

    Promise.all([
      fetchEstimates(unfilteredUrl),
      isFiltered ? fetchEstimates(filteredUrl) : undefined,
    ])
      .then(([unfiltered, filtered]) => {
        if (cancelled) return;
        const unfilteredSizeByPk = new Map(
          unfiltered.map((e) => [e.pk, e.size]),
        );
        setDownloadSizeEstimates(
          (filtered || unfiltered).map((e) => ({
            ...e,
            unfilteredSize: unfilteredSizeByPk.get(e.pk) ?? e.size,
          })),
        );
      })
      .catch((error) => {
        reportError("download size estimate failed", error);
      })
      .finally(() => {
        if (!cancelled) setEstimatesLoading(false);
      });

    setSubmissionState();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    query,
    polygon,
    filterDownloadByTime,
    filterDownloadByDepth,
    filterDownloadByPolygon,
    setSubmissionState,
  ]);

  useEffect(() => {
    if (downloadSizeEstimates) {
      const estimateByPk = new Map(
        downloadSizeEstimates.map((dse) => [dse.pk, dse]),
      );
      const tempData = pointsData.map((ds) => {
        // A dataset the estimate response didn't cover stays listed, just
        // without a size.
        const tempDS = estimateByPk.get(ds.pk) || {
          size: null,
          unfilteredSize: null,
        };
        const estimates = {
          filteredSize: tempDS.size,
          unfilteredSize: tempDS.unfilteredSize,
        };
        return {
          ...ds,
          selected: estimates.filteredSize < 1000000000,
          sizeEstimate: estimates,
          internalDownload: estimates.filteredSize < 1000000000,
          downloadDisabled: estimates.filteredSize > 1000000000,
        };
      });
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPointsData(tempData);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloadSizeEstimates]);

  useEffect(() => {
    if (!isEmpty(pointsData)) {
      setPointsToDownload(
        pointsData.filter((point) => point.selected && !point.downloadDisabled),
      );
      if (downloadSizeEstimates) {
        const filtered = sumSizeEstimates(
          pointsData
            .filter((point) => point.selected)
            .map((point) => point.sizeEstimate.filteredSize),
        );
        const unfiltered = sumSizeEstimates(
          pointsData.map((point) => point.sizeEstimate.unfilteredSize),
        );
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDataTotal({
          filteredSize: filtered.size,
          unfilteredSize: unfiltered.size,
          filteredPartial: filtered.partial,
          unfilteredPartial: unfiltered.partial,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointsData, setPointsToDownload]);

  function handleSelectDataset(point) {
    const dataset = pointsData.filter((p) => p.pk === point.pk)[0];
    if (!point.downloadDisabled) {
      dataset.selected = !point.selected;
    }
    const result = pointsData.map((p) => {
      if (p.pk === point.pk) {
        return dataset;
      } else {
        return p;
      }
    });
    setPointsData(result);
  }

  function handleSelectAllDatasets() {
    setPointsData(
      pointsData.map((p) => {
        return {
          ...p,
          selected: p.downloadDisabled === false ? !selectAll : false,
        };
      }),
    );
    setSelectAll(!selectAll);
  }

  const selectedCount = pointsData.filter((point) => point.selected).length;
  // Includes datasets the 1 GB ceiling deselected: the queue refuses them, and
  // the source queries have no ceiling. `!== false` because `selected` is unset until
  // the estimates land.
  const linkableDatasets = useMemo(
    () =>
      pointsData.filter(
        (point) => point.selected !== false || point.downloadDisabled,
      ),
    [pointsData],
  );
  const obisCount = linkableDatasets.filter(
    (point) => point.source_type === "obis",
  ).length;

  const polygonFiltered = Boolean(polygon?.length && filterDownloadByPolygon);
  const constraints = useMemo(
    () =>
      downloadConstraints({
        query,
        byTime: filterDownloadByTime,
        byDepth: filterDownloadByDepth,
        byPolygon: polygonFiltered,
      }),
    [query, filterDownloadByTime, filterDownloadByDepth, polygonFiltered],
  );
  const linkByPk = useMemo(
    () =>
      new Map(
        buildDownloadLinks(pointsData, packageFormat, constraints).map(
          (link) => [link.pk, link],
        ),
      ),
    [pointsData, packageFormat, constraints],
  );
  const links = useMemo(
    () =>
      linkableDatasets.map((point) => linkByPk.get(point.pk)).filter(Boolean),
    [linkableDatasets, linkByPk],
  );

  return (
    <div className="container downloadDetails">
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
      </div>

      <div className="row downloadDataRow">
        <div className="col">
          <DatasetsTable
            isDownloadModal
            handleSelectAllDatasets={handleSelectAllDatasets}
            handleSelectDataset={handleSelectDataset}
            selectAll={selectAll}
            datasets={pointsData}
            setHoveredDataset={setHoveredDataset}
            downloadSizeEstimates={downloadSizeEstimates}
            estimatesLoading={estimatesLoading}
            downloadLinkByPk={linkByPk}
            obisFallbackFormat={
              OBIS_FORMATS.includes(packageFormat)
                ? undefined
                : t("downloadPackageFormat_csv")
            }
            pagerExtra={
              <div className="downloadSummary">
                {/* Both stats wait for the estimates, which decide how many
                    stay selected. */}
                <div className="downloadSummaryStat">
                  {estimatesLoading ? (
                    <Spinner size="sm" className="datasetSizeTotalSpinner" />
                  ) : (
                    <span className="downloadSummaryValue">
                      {selectedCount}
                      <span className="downloadSummaryValueMuted">{` / ${pointsData.length}`}</span>
                    </span>
                  )}
                  <span className="downloadSummaryLabel">
                    {t("downloadDetailsDownloadInfoDatasets")}
                  </span>
                </div>
                <div className="downloadSummaryDivider" aria-hidden="true" />
                <div className="downloadSummaryStat">
                  {estimatesLoading ? (
                    <Spinner size="sm" className="datasetSizeTotalSpinner" />
                  ) : downloadSizeEstimates ? (
                    <span
                      className="downloadSummaryValue"
                      title={
                        dataTotal.filteredPartial || dataTotal.unfilteredPartial
                          ? t("downloadSizePartialTitle")
                          : undefined
                      }
                    >
                      {formatSizeEstimate(dataTotal.filteredSize)}
                      {dataTotal.filteredPartial && "+"}
                      <span className="downloadSummaryValueMuted">{` / ${formatSizeEstimate(
                        dataTotal.unfilteredSize,
                      )}${dataTotal.unfilteredPartial ? "+" : ""}`}</span>
                    </span>
                  ) : (
                    <span
                      className="downloadSummaryValue downloadSummaryValueMuted"
                      title={t("downloadSizeUnavailableTitle")}
                    >
                      {t("downloadSizeUnavailable")}
                    </span>
                  )}
                  <span className="downloadSummaryLabel">
                    {t("downloadDetailsDownloadInfoDownloadSize")}
                  </span>
                </div>
              </div>
            }
          />
        </div>
      </div>

      <div className="downloadFooter">
        {/* Two ways to the data, so they share one section. */}
        <div className="downloadFooterSection downloadDelivery">
          <div className="downloadDeliveryHeader">
            <div className="downloadDeliveryHeading">
              <span className="downloadFooterTitle">
                {t("downloadDeliveryTitle")}
              </span>
              <p className="downloadDeliveryIntro">
                {t("downloadDeliveryIntro")}
              </p>
            </div>
            <DownloadFormat obisCount={obisCount} />
          </div>
          <div className="downloadDeliveryOptions">
            {children}
            <span className="downloadDeliveryOr" aria-hidden="true">
              {t("downloadDeliveryOr")}
            </span>
            <DownloadLinks
              count={linkableDatasets.length}
              links={links}
              polygonFiltered={polygonFiltered}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
