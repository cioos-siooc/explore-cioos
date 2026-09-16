import * as React from "react";
import { useMemo, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import isEmpty from "lodash-es/isEmpty";

import DatasetsTable from "../DatasetsTable/DatasetsTable.jsx";
import DirectDownloadLinks from "./DirectDownloadLinks.jsx";
import DownloadFormats from "./DownloadFormats.jsx";
import FilterDownloadToggles from "./FilterDownloadToggles.jsx";

import { useActivityTask } from "../../../state/activity/ActivityProvider.jsx";

import {
  createDataFilterQueryString,
  formatSizeEstimate,
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
  defaultErddapFormat,
  defaultObisFormat,
  downloadConstraints,
} from "../../../downloadLinks.js";
import reportError from "../../../state/reportError.js";
import "./styles.css";
import Spinner from "../../ui/Spinner.jsx";

/*
 * The order under review: every dataset in the selection as a card carrying its
 * size estimate, whether the CDE can package it, and its direct download URL —
 * then the totals and, as `children`, the order bar's own controls.
 *
 * The filter switches arrive as values only: the chips that set them sit above
 * this component (DownloadPanel), because the same switches decide both what a
 * packaged order contains and what the links carry.
 *
 * Note: datasets and points are exchangable terminology
 */
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
  const [selectAll, setSelectAll] = useState(true);
  // The download format lives here rather than with either of the things that
  // read it, because two do: the export buttons in the footer, which take the
  // links in bulk, and every card in the list, which shows the one query its
  // own dataset would be fetched with. Building the links once here is what
  // keeps the two in step — a card promising a .csv under a footer set to
  // Parquet would be a lie about the same order. The picker itself sits on the
  // list's toolbar (DownloadFormats), which is the one place above both.
  const [erddapFormat, setErddapFormat] = useState(defaultErddapFormat);
  const [obisFormat, setObisFormat] = useState(defaultObisFormat);
  const [pointsData, setPointsData] = useState(
    pointsToReview
      // defensive: griddap datasets are metadata-only and must never reach
      // the size-estimate / download-queue flow
      .filter((ptr) => ptr.cdm_data_type !== "Grid")
      .map((ptr) => {
        return { ...ptr, downloadDisabled: false };
      }),
  );
  const [dataTotal, setDataTotal] = useState(0);
  const [downloadSizeEstimates, setDownloadSizeEstimates] = useState();
  // Three states, not two: estimates in flight (spinner), estimates in
  // (sizes), estimates failed (no sizes, no spinner). The old code threw from
  // its catch handlers, which skipped the setLoading(false) chained after
  // them — a failing /downloadEstimate spun forever, in every card and in the
  // order summary.
  const [estimatesLoading, setEstimatesLoading] = useState(true);
  // Reported by the corner badge as well as by the figures it stands in for:
  // the estimate is the slowest thing in this modal and the user may well
  // have looked away from it.
  useActivityTask("activityEstimatesText", estimatesLoading);

  // The three effects below are a pipeline, and each one's dependency array is
  // deliberately shorter than what it reads:
  //
  //   fetch estimates  ->  merge them into pointsData  ->  totals + basket
  //
  // The middle step writes `pointsData`, which the first and second both read.
  // Listing it in either would feed the pipeline its own output. The third
  // cannot list `downloadSizeEstimates` either: it would then run once against
  // the pre-merge rows, where `sizeEstimate` does not exist yet.
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEstimatesLoading(true);
    setDownloadSizeEstimates();

    const unfilteredUrl = `${server}/downloadEstimate?&datasetPKs=${pointsData
      .map((ds) => ds.pk)
      .join(",")}`;
    // The download can be narrowed by any of the active filters; when none of
    // them applies, the unfiltered estimate is the estimate.
    const isFiltered =
      filterDownloadByPolygon || filterDownloadByTime || filterDownloadByDepth;
    let filteredUrl = unfilteredUrl;
    if (isFiltered) {
      if (polygon && filterDownloadByPolygon) {
        filteredUrl += `&polygon=${JSON.stringify(polygon)}`;
      }
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
        filteredUrl += `&${createDataFilterQueryString(tempQuery)}`;
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
      let tempDataTotal = 0;
      let tempDataDownloadable = 0;
      const estimateByPk = new Map(
        downloadSizeEstimates.map((dse) => [dse.pk, dse]),
      );
      const tempData = pointsData.map((ds) => {
        // A dataset the estimate response didn't cover reads as 0 bytes rather
        // than throwing — it stays listed, just without a usable size.
        const tempDS = estimateByPk.get(ds.pk) || {
          size: 0,
          unfilteredSize: 0,
        };
        const estimates = {
          filteredSize: tempDS.size,
          unfilteredSize: tempDS.unfilteredSize,
        };
        tempDataTotal = tempDataTotal + tempDS.unfilteredSize;
        tempDataDownloadable = tempDataDownloadable + tempDS.size;
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
      setDataTotal({
        unfilteredSize: tempDataTotal,
        filteredSize: tempDataDownloadable,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloadSizeEstimates]);

  useEffect(() => {
    if (!isEmpty(pointsData)) {
      setPointsToDownload(
        pointsData.filter((point) => point.selected && !point.downloadDisabled),
      );
      if (downloadSizeEstimates) {
        let tempDataTotal = 0;
        let tempDataDownloadable = 0;
        pointsData.forEach((point) => {
          tempDataTotal = tempDataTotal + point.sizeEstimate.unfilteredSize;
          if (point.selected) {
            tempDataDownloadable =
              tempDataDownloadable + point.sizeEstimate.filteredSize;
          }
        });
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDataTotal({
          unfilteredSize: tempDataTotal,
          filteredSize: tempDataDownloadable,
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
  // What the direct links are built from: everything the user kept, plus the
  // datasets the 1 GB ceiling deselected for them. Those are exactly the ones
  // the CDE's queue refuses to deliver, which is where a direct link is worth
  // most — leaving them out would hide the feature from the case it exists for.
  //
  // `!== false` rather than truthy: `selected` is only set once the size
  // estimates land, and a direct link needs no estimate. Testing for truth
  // would empty the links strip for as long as the slowest request in this
  // modal takes, which reads as broken rather than as pending.
  const linkableDatasets = useMemo(
    () =>
      pointsData.filter(
        (point) => point.selected !== false || point.downloadDisabled,
      ),
    [pointsData],
  );

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

  const links = useMemo(
    () =>
      buildDownloadLinks(
        linkableDatasets,
        { erddapFormat, obisFormat },
        constraints,
      ),
    [linkableDatasets, erddapFormat, obisFormat, constraints],
  );

  // The card for a dataset shows that dataset's own query, so the list needs
  // the links by pk rather than in order.
  const linksByPk = useMemo(
    () => new Map(links.map((link) => [link.pk, link])),
    [links],
  );

  return (
    <div className="container downloadDetails">
      {/* One row of chrome: what the order narrows by. Every row spent here is
          a row of datasets the list below does not show. */}
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
            downloadLinksByPk={linksByPk}
            downloadFormatControls={
              <DownloadFormats
                links={links}
                erddapFormat={erddapFormat}
                setErddapFormat={setErddapFormat}
                obisFormat={obisFormat}
                setObisFormat={setObisFormat}
              />
            }
          />
        </div>
      </div>

      {/* The order's three outcomes on one band: what you picked, having it
          emailed, and taking the URLs yourself. The last two are alternative
          ways to ship the first, so they sit beside it rather than under it —
          neither is a mode of the modal, and a user weighing one against the
          other can read both without scrolling. */}
      <div className="downloadFooter">
        <div className="downloadFooterSection">
          <span className="downloadFooterTitle">
            {t("downloadDetailsSelectionTitle")}
          </span>
          <div className="downloadSummary">
            {/* The estimates decide which datasets are downloadable, hence how
              many stay selected — so both stats wait for them rather than
              showing a count that is about to change under the user. If they
              fail outright, the sizes are unknowable but the counts aren't. */}
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
                <span className="downloadSummaryValue">
                  {formatSizeEstimate(dataTotal.filteredSize)}
                  <span className="downloadSummaryValueMuted">{` / ${formatSizeEstimate(
                    dataTotal.unfilteredSize,
                  )}`}</span>
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
        </div>

        {/* Column two, the queue: DownloadPanel's email field and submit. */}
        {children}

        {/* Column three, the same order taken from the source instead of the
            queue. Beside the summary rather than behind a tab, because one of
            the things it answers ("this dataset is too large for the zip") is
            only legible next to the figures that say so. */}
        <DirectDownloadLinks links={links} constraints={constraints} />
      </div>
    </div>
  );
}
