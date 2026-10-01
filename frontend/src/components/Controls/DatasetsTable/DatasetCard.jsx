import React from "react";
import {
  BoxArrowUpRight,
  CalendarCheck,
  CheckCircleFill,
  CircleFill,
  Clipboard,
  ClipboardCheck,
  Download,
  ExclamationTriangleFill,
  Grid3x3Gap,
  HexagonFill,
  Check2Circle,
  XCircle,
  Server,
  PinMapFill,
  FileEarmarkSpreadsheet,
  X,
} from "react-bootstrap-icons";
import classNames from "classnames";
import isEmpty from "lodash-es/isEmpty";

import platformColors from "../../platformColors";
import { formatErddapServerName, formatSizeEstimate } from "../../../utilities";
import { formatGridSize } from "../../../wmsUtilities";
import erddapServersJSONfile from "../../../erddapServers.json";
import Skeleton from "../../ui/Skeleton.jsx";
import Spinner from "../../ui/Spinner.jsx";
import Tooltip from "../../ui/Tooltip.jsx";
import useCopyToClipboard from "../../../state/useCopyToClipboard.js";

// A single dataset rendered as a card. Shared shell for the sidebar list and
// the download-review modal; the modal variant (isDownloadModal) adds the size
// estimate, the CDE-downloadable status, where the dataset lives (its server
// and its catalogue record) and the query that would fetch it.
export default function DatasetCard({
  row,
  selected,
  isDownloadModal,
  downloadSizeEstimates,
  estimatesLoading,
  // This dataset's direct-download link (download modal only), already built
  // from the map's filters and the chosen format — see downloadLinks.js.
  downloadLink,
  onSelect,
  onInspect,
  // Drops the dataset from the order entirely (download modal only) — unlike
  // onSelect, which only ticks it in or out of this particular batch, this
  // takes the row off the list.
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
  // For the select toggle's `data-tip-highlight` (see TipsProvider).
  tipHighlight,
  t,
  i18n,
}) {
  const [copyState, copy] = useCopyToClipboard("a dataset download link");
  const isGrid = row.cdm_data_type === "Grid";
  const isObis = row.source_type === "obis";
  // griddap is metadata-only, and in the modal a dataset is only selectable
  // when the CDE can deliver it (internalDownload).
  const selectDisabled = isGrid || (isDownloadModal && !row.internalDownload);
  const estimatesReady = !isEmpty(downloadSizeEstimates);
  // Estimates that failed to load: the size and download status are unknown,
  // and no amount of waiting will produce them — say so instead of spinning.
  const estimatesFailed = !estimatesLoading && !estimatesReady;

  const handleSelect = (e) => {
    // The card itself opens the dataset page; this control must not.
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
      <div className="datasetCardBody">
        <div className="datasetCardHeadline">
          {/* Whether this dataset is in the download: first thing on the
              title's line, ahead of the platform dot. The glyph says which way
              the click goes rather than colouring a ground — a download sign
              while the dataset is out, the filled circle of a ticked box once
              it is in. Both read at a glance down the left edge of the list,
              which is what asking "which of these have I picked?" amounts to.
              role=checkbox because that is what it is; a button carries the
              icon a native input cannot. */}
          <button
            type="button"
            role="checkbox"
            aria-checked={Boolean(selected)}
            className={classNames("datasetCardSelect", { checked: selected })}
            title={selectTitle}
            onClick={handleSelect}
            disabled={selectDisabled}
            aria-label={t("datasetsCardSelectForDownloadText")}
            data-tip-highlight={tipHighlight}
          >
            {selected ? (
              <CheckCircleFill size={16} aria-hidden="true" />
            ) : (
              <Download size={16} aria-hidden="true" />
            )}
          </button>

          {/* The wrapper is the height of the title's first line, so the dot
              stays centered on that line however the title wraps. */}
          <span className="datasetCardPlatform">
            <DatasetPlatformIcon
              platform={row.platform}
              cdmDataType={row.cdm_data_type}
              sourceType={row.source_type}
              t={t}
            />
          </span>
          <span className="datasetCardTitle" title={row.title}>
            {row.title}
          </span>

          {/* Size and CDE-downloadable status, on the title's line rather than
              a row of their own. Both are a glyph and a few characters wide,
              and the ragged right of a wrapped title is the space they fit
              in — a full-width row for them was what made these cards need to
              be wide. */}
          {isDownloadModal && (
            <span className="datasetCardDownloadInfo">
              {estimatesReady ? (
                <Tooltip
                  placement="top"
                  content={t(
                    row.internalDownload
                      ? "datasetTableDownloadModalCDEDownloadableColumnNameTooltip"
                      : "datasetTableDownloadModalNotCDEDownloadableColumnNameTooltip",
                  )}
                >
                  {/* The tick and the pill's colour say the same thing, and
                      the legend above the list names both — so neither is
                      spelled out here. The word survives on the glyph's own
                      <title>, the way the platform dot above carries its
                      platform, because colour alone never carries it. */}
                  <span className="datasetCardStatus">
                    {row.internalDownload ? (
                      <Check2Circle
                        className="downloadableIcon success"
                        title={t("datasetsCardSortDownloadableText")}
                        size={16}
                      />
                    ) : (
                      <XCircle
                        className="downloadableIcon error"
                        title={t("datasetsCardNotDownloadableText")}
                        size={16}
                      />
                    )}
                    <span
                      className={classNames("datasetCardSizePill", {
                        downloadable:
                          row?.sizeEstimate?.filteredSize < 1000000000,
                      })}
                    >
                      {formatSizeEstimate(row?.sizeEstimate?.filteredSize)}
                    </span>
                    {/* What the dataset holds before the map's filters, shown
                        only when the filters actually narrowed it — otherwise
                        it is the pill again, in the one place with no width to
                        spare. */}
                    {row?.sizeEstimate?.filteredSize !==
                      row?.sizeEstimate?.unfilteredSize && (
                      <span className="datasetCardSizeTotal">
                        {`/ ${formatSizeEstimate(
                          row?.sizeEstimate?.unfilteredSize,
                        )}`}
                      </span>
                    )}
                  </span>
                </Tooltip>
              ) : estimatesFailed ? (
                // The em dash the order bar below uses for the same failure,
                // rather than the sentence: in this slot the sentence would be
                // taking width from the title to say nothing is known.
                <span
                  className="datasetCardSizeUnavailable"
                  title={t("downloadSizeUnavailableTitle")}
                >
                  {t("downloadSizeUnavailable")}
                </span>
              ) : (
                <Spinner size="sm" className="datasetsTableSpinner" />
              )}
            </span>
          )}

          {/* Drops the dataset from the order outright. Separate from the
              checkbox at the other end of this row on purpose: that one only
              decides whether this batch includes it, and stays available for
              a dataset the 1 GB ceiling excluded — removing it here is the
              only way out for that one. */}
          {isDownloadModal && onRemove && (
            <button
              type="button"
              className="datasetCardRemove"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(row);
              }}
              title={t("datasetCardRemoveFromSelectionTitle")}
              aria-label={`${t("datasetCardRemoveFromSelectionTitle")}: ${row.title}`}
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>

        <DatasetCardMeta row={row} t={t} i18n={i18n} />

        {/* Where this dataset lives and how to fetch it, outside the estimates
            branch because none of it depends on them: the one dataset the
            queue will refuse is also the one these are wanted for, and making
            them wait on the slowest request in the modal is what hid them. */}
        {isDownloadModal && (
          <div className="datasetCardSources">
            {row.erddap_url && (
              <a
                className="datasetCardSourceLink"
                href={row.erddap_url}
                title={row.erddap_url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                <BoxArrowUpRight size={12} aria-hidden="true" />
                {isObis ? "OBIS" : "ERDDAP™"}
              </a>
            )}
            {/* The CIOOS catalogue record: licence, citation and contacts,
                which are what make a downloaded file usable later. Null for a
                dataset the harvest never matched to a CKAN entry. */}
            {row.ckan_url && (
              <a
                className="datasetCardSourceLink"
                href={row.ckan_url}
                title={row.ckan_url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                <BoxArrowUpRight size={12} aria-hidden="true" />
                {t("datasetCardCatalogueLinkText")}
              </a>
            )}
            {/* The link that fetches data rather than opening a page, the
                caveat that applies to it, and the copy of it. One group: what
                arrives, what is wrong with it, and how to take it away are
                read together or not at all. */}
            {downloadLink && (
              <span className="datasetCardDownloadGroup">
                {/* This link asks ERDDAP for the bounding box of a shape that
                    is not a box, so the file holds points from outside the
                    selection. On the link itself because that is what carries
                    the flaw — the queued zip beside it respects the polygon. */}
                {downloadLink.polygonSquared && (
                  <Tooltip
                    placement="top"
                    content={t("directLinksNotePolygon")}
                  >
                    <span
                      className="datasetCardLinkWarning"
                      role="img"
                      aria-label={t("directLinksNotePolygon")}
                    >
                      <ExclamationTriangleFill size={13} aria-hidden="true" />
                    </span>
                  </Tooltip>
                )}
                <a
                  className="datasetCardSourceLink download"
                  href={downloadLink.url}
                  download={downloadLink.filename}
                  title={downloadLink.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Download size={12} aria-hidden="true" />
                  {t("datasetCardDirectDownloadText", {
                    format: downloadLink.format.label,
                  })}
                </a>
                {/* The URL, for the script or the note it is going into. It
                    replaces the query this card used to print in full: a URL
                    that is read is almost always a URL that is about to be
                    copied, and the copy takes a line rather than four. */}
                <Tooltip
                  placement="top"
                  content={
                    copyState === "copied"
                      ? t("directLinksCopied")
                      : copyState === "failed"
                        ? t("directLinksCopyFailed")
                        : t("datasetCardCopyLinkText")
                  }
                >
                  <button
                    type="button"
                    className="datasetCardCopyLink"
                    aria-label={t("datasetCardCopyLinkText")}
                    onClick={(e) => {
                      // The card's own click opens the dataset page.
                      e.stopPropagation();
                      copy(downloadLink.url);
                    }}
                  >
                    {copyState === "copied" ? (
                      <ClipboardCheck size={13} aria-hidden="true" />
                    ) : (
                      <Clipboard size={13} aria-hidden="true" />
                    )}
                  </button>
                </Tooltip>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// The dataset's glyph, shaped like what the map draws for it: a grid for a
// gridded footprint, a hexagon for trajectories and OBIS (shown as hex cells),
// a dot for everything drawn as markers. Coloured by platform.
// A sidebar card's outline while the first results are on their way, built in
// the card's own text classes so it lands at the height of a card with a
// two-line title.
export function DatasetCardSkeleton() {
  return (
    <div className="datasetCard" aria-hidden="true">
      <div className="datasetCardBody">
        <div className="datasetCardHeadline">
          <span className="datasetCardSelect">
            <Skeleton width="16px" height="16px" radius="50%" />
          </span>
          <span className="datasetCardTitle">
            <Skeleton text />
            <Skeleton text width="60%" />
          </span>
        </div>
        <div className="datasetCardMeta">
          <Skeleton text width="45%" />
        </div>
      </div>
    </div>
  );
}

export function DatasetPlatformIcon({ platform, cdmDataType, sourceType, t }) {
  if (cdmDataType === "Grid") {
    return (
      <Grid3x3Gap title={t("griddapTypeLabel")} color="#52a79b" size={13} />
    );
  }
  const Icon =
    cdmDataType === "Trajectory" || sourceType === "obis"
      ? HexagonFill
      : CircleFill;
  const platformColor = platformColors.find((pc) => pc.platform === platform);
  return (
    <Icon
      title={t(platform)}
      fill={platformColor?.color || "#000000"}
      size={13}
    />
  );
}

// The card's second row: where the dataset lives, what kind it is, how many
// locations and days it holds, and whether it is live. Shared with the map's
// "what's here" card so a dataset reads the same in both lists.
export function DatasetCardMeta({ row, t, i18n }) {
  const isGrid = row.cdm_data_type === "Grid";
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

  return (
    <span className="datasetCardMeta">
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
      {row.days != null && (
        <span
          className="datasetCardMetaItem"
          title={t("datasetsCardSortDaysText")}
        >
          <CalendarCheck size={13} aria-hidden="true" />
          {Number(row.days).toLocaleString(i18n.language)}
        </span>
      )}

      {/* Same "still producing data" signal as the dataset inspector's
          Last update row — on this row here since it is the card's other
          home for small dataset-level facts. */}
      {row.is_realtime && (
        <span
          className="datasetCardLive"
          title={t("datasetRealtimeBadgeTitle")}
        >
          {t("datasetRealtimeBadgeText")}
        </span>
      )}
    </span>
  );
}
