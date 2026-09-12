import React from "react";
import {
  BoxArrowUpRight,
  CircleFill,
  Download,
  Grid3x3Gap,
  Check2Circle,
  X,
  XCircle,
  Server,
  PinMapFill,
  FileEarmarkSpreadsheet,
} from "react-bootstrap-icons";
import classNames from "classnames";
import bytes from "bytes";
import isEmpty from "lodash-es/isEmpty";

import platformColors from "../../platformColors";
import { formatErddapServerName } from "../../../utilities";
import { formatGridSize } from "../../../wmsUtilities";
import erddapServersJSONfile from "../../../erddapServers.json";
import Spinner from "../../ui/Spinner.jsx";
import Tooltip from "../../ui/Tooltip.jsx";

// A single dataset rendered as a card. Shared shell for the sidebar list and
// the download-review modal; the modal variant (isDownloadModal) adds the
// size estimate, CDE-downloadable status and the dataset's own ERDDAP URL.
export default function DatasetCard({
  row,
  selected,
  isDownloadModal,
  downloadSizeEstimates,
  estimatesLoading,
  onSelect,
  onInspect,
  onRemove,
  onHover = () => {},
  onHoverEnd = () => {},
  // The card's group is hidden from the map: the dataset stays in the list
  // (and downloadable), so it's dimmed rather than dropped.
  hiddenFromMap,
  // This dataset is one the last map click found. It has already been sorted to
  // the top of the list; the accent is what says why it is up there, so the
  // reordering reads as an answer rather than as the list having shuffled
  // itself.
  fromMapClick,
  t,
  i18n,
}) {
  const isGrid = row.cdm_data_type === "Grid";
  // griddap is metadata-only, and in the modal a dataset is only selectable
  // when the CDE can deliver it (internalDownload).
  const selectDisabled = isGrid || (isDownloadModal && !row.internalDownload);
  const estimatesReady = !isEmpty(downloadSizeEstimates);
  // Estimates that failed to load: the size and download status are unknown,
  // and no amount of waiting will produce them — say so instead of spinning.
  const estimatesFailed = !estimatesLoading && !estimatesReady;

  const handleSelect = (e) => {
    e.stopPropagation();
    if (!selectDisabled) onSelect(row);
  };

  const clickable = typeof onInspect === "function";
  const handleCardClick = clickable ? () => onInspect(row) : undefined;
  const handleKeyDown = clickable
    ? (e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onInspect(row);
        }
      }
    : undefined;

  const platformColor = platformColors.find(
    (pc) => pc.platform === row.platform,
  );

  const serverName = formatErddapServerName(
    row.erddap_server_url || row.erddap_url,
    i18n.language,
    erddapServersJSONfile,
  );

  const typeLabel = isGrid
    ? t("griddapTypeLabel")
    : (row.cdm_data_type || "")
        .replace("TimeSeriesProfile", "Time series / Profile")
        .replace("TimeSeries", "Time series");

  const locationsLabel = isGrid
    ? formatGridSize(row.grid_dimensions) || "—"
    : row.profiles_count !== row.n_profiles
      ? `${row.profiles_count} / ${row.n_profiles}`
      : row.profiles_count;

  const selectTitle = isGrid
    ? t("griddapNotDownloadableTooltip")
    : t("datasetsTableDownloadModalDatasetCheckboxTooltip");

  return (
    <div
      data-testid="dataset-card"
      data-dataset-pk={row.pk}
      data-selected={Boolean(selected)}
      className={classNames("datasetCard", {
        selected,
        shortlisted: typeof onRemove === "function",
        clickable,
        downloadModal: isDownloadModal,
        hiddenFromMap,
        fromMapClick,
      })}
      title={fromMapClick ? t("datasetCardFromMapTitle") : undefined}
      onClick={handleCardClick}
      onMouseEnter={() => onHover(row)}
      onMouseLeave={() => onHoverEnd()}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={handleKeyDown}
    >
      {onRemove && (
        <button
          type="button"
          className="datasetCardRemove"
          title={t("datasetsCardShortlistRemoveTitle")}
          aria-label={t("datasetsCardShortlistRemoveTitle")}
          onClick={(event) => {
            event.stopPropagation();
            onRemove(row.pk);
          }}
        >
          <X size={15} aria-hidden="true" />
        </button>
      )}

      {/* The download glyph stays constant; its ground changes to show whether
          this dataset is included in the download basket. */}
      <button
        type="button"
        className={classNames("datasetCardAdd", { checked: selected })}
        title={selectTitle}
        onClick={handleSelect}
        disabled={selectDisabled}
        aria-pressed={Boolean(selected)}
        aria-label={t("datasetsCardSelectForDownloadText")}
      >
        <Download size={15} aria-hidden="true" />
      </button>

      <div className="datasetCardBody">
        <div className="datasetCardHeadline">
          {/* The wrapper is the height of the title's first line, so the dot
              stays centered on that line however the title wraps. */}
          <span className="datasetCardPlatform">
            {isGrid ? (
              <Grid3x3Gap
                title={t("griddapTypeLabel")}
                color="#52a79b"
                size={15}
              />
            ) : (
              <CircleFill
                title={t(row.platform)}
                fill={platformColor?.color || "#000000"}
                size={13}
              />
            )}
          </span>
          <span className="datasetCardTitle" title={row.title}>
            {row.title}
          </span>
        </div>

        <div className="datasetCardMeta">
          <span className="datasetCardMetaItem" title="ERDDAP™ Server">
            <Server size={13} aria-hidden="true" />
            {serverName}
          </span>
          <span
            className="datasetCardMetaItem"
            title={t("datasetsTableHeaderTypeText")}
          >
            <FileEarmarkSpreadsheet size={13} aria-hidden="true" />
            {typeLabel}
          </span>
          <span
            className="datasetCardMetaItem"
            title={
              isGrid
                ? t("griddapGridSizeTooltip")
                : t("datasetsTableHeaderLocationsText")
            }
          >
            <PinMapFill size={13} aria-hidden="true" />
            {locationsLabel}
          </span>
        </div>

        {isDownloadModal && (
          <div className="datasetCardDownloadInfo">
            {estimatesReady ? (
              <>
                <span className="datasetCardSize">
                  <span
                    className={classNames("datasetCardSizePill", {
                      downloadable:
                        row?.sizeEstimate?.filteredSize < 1000000000,
                    })}
                  >
                    {bytes(row?.sizeEstimate?.filteredSize)}
                  </span>
                  {row?.sizeEstimate?.filteredSize !==
                    row?.sizeEstimate?.unfilteredSize &&
                    ` / ${bytes(row?.sizeEstimate?.unfilteredSize)}`}
                </span>
                <Tooltip
                  placement="top"
                  content={t(
                    row.internalDownload
                      ? "datasetTableDownloadModalCDEDownloadableColumnNameTooltip"
                      : "datasetTableDownloadModalNotCDEDownloadableColumnNameTooltip",
                  )}
                >
                  <span className="datasetCardStatus">
                    {row.internalDownload ? (
                      <Check2Circle
                        className="downloadableIcon success"
                        size={18}
                      />
                    ) : (
                      <XCircle className="downloadableIcon error" size={18} />
                    )}
                    {t(
                      row.internalDownload
                        ? "datasetsCardSortDownloadableText"
                        : "datasetsCardNotDownloadableText",
                    )}
                  </span>
                </Tooltip>
              </>
            ) : estimatesFailed ? (
              <span className="datasetCardSizeUnavailable">
                {t("downloadSizeUnavailableTitle")}
              </span>
            ) : (
              <Spinner size="sm" className="datasetsTableSpinner" />
            )}

            {/* Where this dataset is actually served from. Outside the
                estimates branch because the URL does not depend on them: the
                one dataset the queue will refuse is also the one whose link is
                wanted soonest, and making it wait on the slowest request in the
                modal is what hid it. */}
            {row.erddapLink && (
              <a
                className="datasetCardSourceLink"
                href={row.erddapLink}
                title={row.erddapLink}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                <BoxArrowUpRight size={12} aria-hidden="true" />
                ERDDAP™
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
