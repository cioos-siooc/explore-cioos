import React from "react";
import {
  BoxArrowUpRight,
  CalendarCheck,
  CheckCircleFill,
  CircleFill,
  Download,
  ExclamationTriangle,
  PlusCircle,
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
import { useTranslation } from "react-i18next";
import isEmpty from "lodash-es/isEmpty";

import {
  platformColor,
  platformInk,
  platformLabel,
} from "../../../platformVocab.js";
import { formatErddapServerName, formatSizeEstimate } from "../../../utilities";
import { formatGridSize } from "../../../wmsUtilities";
import {
  localizedCkanUrl,
  localizedErddapUrl,
} from "../../../downloadLinks.js";
import erddapServersJSONfile from "../../../erddapServers.json";
import {
  cdmDataTypeLabel,
  dataLayerKeyForDataset,
} from "../../../state/dataLayers.js";
import DataTypeIcon from "../../ui/DataTypeIcon.jsx";
import Spinner from "../../ui/Spinner.jsx";
import Tooltip from "../../ui/Tooltip.jsx";

export default function DatasetCard({
  row,
  selected,
  isDownloadModal,
  downloadSizeEstimates,
  estimatesLoading,
  // The source link the download modal built for this row.
  downloadLink,
  onSelect,
  onInspect,
  // Unlike onSelect (in or out of this batch), takes the row off the order.
  onRemove,
  onHover = () => {},
  onHoverEnd = () => {},
  fromMapClick,
  tipHighlight,
  t,
  i18n,
  // Extra lines under the meta, e.g. the "what's here" card's cell figures.
  children,
}) {
  const isGrid = row.cdm_data_type === "Grid";
  const isObis = row.source_type === "obis";
  const erddapUrl = localizedErddapUrl(row, row.erddap_url, i18n.language);
  const ckanUrl = localizedCkanUrl(row.ckan_url, i18n.language);
  // griddap is metadata-only, and in the modal a dataset is only selectable
  // when the CDE can deliver it (internalDownload).
  const selectDisabled = isGrid || (isDownloadModal && !row.internalDownload);
  const estimatesReady = !isEmpty(downloadSizeEstimates);
  // Failed estimates will never arrive: say so instead of spinning.
  const estimatesFailed = !estimatesLoading && !estimatesReady;

  const handleSelect = (e) => {
    // The card itself opens the dataset page; this control must not.
    e.stopPropagation();
    if (!selectDisabled) onSelect(row);
  };

  const clickable = typeof onInspect === "function";
  const handleCardClick = clickable ? () => onInspect(row) : undefined;

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
        fromMapClick,
      })}
      title={fromMapClick ? t("datasetCardFromMapTitle") : undefined}
      onClick={handleCardClick}
      onMouseEnter={() => onHover(row)}
      onMouseLeave={() => onHoverEnd()}
    >
      {row.is_realtime && (
        <span
          className="datasetCardLive"
          title={t("datasetRealtimeBadgeTitle")}
        >
          {t("datasetRealtimeBadgeText")}
        </span>
      )}
      <div className="datasetCardBody">
        <div className="datasetCardHeadline">
          {/* The whole card can't be a button because it holds the checkbox
              and links. Its click bubbles to the card's own handler. */}
          {clickable ? (
            <button
              type="button"
              className="datasetCardTitle"
              title={row.title}
            >
              {row.title}
            </button>
          ) : (
            <span className="datasetCardTitle" title={row.title}>
              {row.title}
            </span>
          )}

          {/* A button with role=checkbox: it carries an icon a native input
              cannot. */}
          <button
            type="button"
            role="checkbox"
            aria-checked={Boolean(selected)}
            className={classNames("datasetCardSelect", { checked: selected })}
            title={selectTitle}
            onClick={handleSelect}
            disabled={selectDisabled}
            aria-label={`${t("datasetsCardSelectForDownloadText")}: ${row.title}`}
            data-tip-highlight={tipHighlight}
          >
            {selected ? (
              <CheckCircleFill size={16} aria-hidden="true" />
            ) : (
              <PlusCircle size={16} aria-hidden="true" />
            )}
          </button>

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
                  {/* Colour alone never carries the status: the word is on
                      the glyph's own <title>. */}
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
                      title={
                        Number.isFinite(row?.sizeEstimate?.filteredSize)
                          ? undefined
                          : t("downloadSizeUnavailableTitle")
                      }
                    >
                      {formatSizeEstimate(row?.sizeEstimate?.filteredSize)}
                    </span>
                    {/* Shown only when the map's filters narrowed it. */}
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

          {/* Separate from the checkbox: for a dataset the 1 GB ceiling
              excluded, this is the only way out of the order. */}
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
        {children}

        {/* Outside the estimates branch: the dataset the queue refuses is the
            one these links are wanted for. */}
        {isDownloadModal && (
          <div className="datasetCardSources">
            {row.erddap_url && (
              <a
                className="datasetCardSourceLink"
                href={erddapUrl}
                title={erddapUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                <BoxArrowUpRight size={12} aria-hidden="true" />
                {isObis ? "OBIS" : "ERDDAP™"}
              </a>
            )}
            {downloadLink?.url && (
              <a
                className="datasetCardSourceLink"
                href={downloadLink.url}
                title={downloadLink.url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                <Download size={12} aria-hidden="true" />
                {isObis ? "DwC-A" : t("datasetCardDataLinkText")}
              </a>
            )}
            {downloadLink?.unapplied.length > 0 && (
              <span
                className="datasetCardFormatTag datasetCardUnapplied"
                title={t("datasetCardUnappliedTitle", {
                  filters: new Intl.ListFormat(i18n.language).format(
                    downloadLink.unapplied.map((filter) =>
                      t(`downloadFilterName_${filter}`),
                    ),
                  ),
                })}
              >
                <ExclamationTriangle size={11} aria-hidden="true" />
                {t("datasetCardUnappliedText")}
              </span>
            )}
            {row.ckan_url && (
              <a
                className="datasetCardSourceLink"
                href={ckanUrl}
                title={ckanUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                <BoxArrowUpRight size={12} aria-hidden="true" />
                {t("datasetCardCatalogueLinkText")}
              </a>
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
// `decorative` drops the tooltip for a spot whose own text already names it.
export function DatasetPlatformIcon({
  platform,
  cdmDataType,
  sourceType,
  t,
  decorative,
}) {
  const { i18n } = useTranslation();
  // Grid amber, the colour the map draws gridded coverage in.
  if (cdmDataType === "Grid") {
    return (
      <Grid3x3Gap
        title={decorative ? undefined : t("griddapTypeLabel")}
        color="var(--cioos-grid-700)"
        size={13}
      />
    );
  }
  const Icon =
    cdmDataType === "Trajectory" || sourceType === "obis"
      ? HexagonFill
      : CircleFill;
  return (
    <Icon
      className="platformGlyph"
      title={decorative ? undefined : platformLabel(platform, i18n.language)}
      fill={platformColor(platform)}
      size={13}
    />
  );
}

// The figure alone on the card; the full wording is the tooltip and, for
// screen readers, the item's text.
function MetaIconItem({ icon, label, children }) {
  return (
    <Tooltip placement="top" content={label}>
      <span className="datasetCardMetaItem">
        {icon}
        {children && <span aria-hidden="true">{children}</span>}
        <span className="sr-only">{label}</span>
      </span>
    </Tooltip>
  );
}

function locationsCount(row, language) {
  const format = (n) => new Intl.NumberFormat(language).format(n);
  const count = Number(row.profiles_count);
  const total = row.n_profiles == null ? undefined : Number(row.n_profiles);
  return total !== undefined && count < total
    ? `${format(count)}/${format(total)}`
    : format(count);
}

function DatasetCardMeta({ row, t, i18n }) {
  const isGrid = row.cdm_data_type === "Grid";
  const serverName = formatErddapServerName(
    row.erddap_server_url || row.erddap_url,
    i18n.language,
    erddapServersJSONfile,
  );
  const typeLabel = isGrid
    ? t("griddapTypeLabel")
    : cdmDataTypeLabel(row.cdm_data_type, t) || "";
  const gridSize = isGrid && (formatGridSize(row.grid_dimensions) || "—");
  const layerKey = dataLayerKeyForDataset(row);

  return (
    <span className="datasetCardMeta">
      <MetaIconItem
        icon={
          <span
            className="datasetCardTypeChip"
            style={{
              backgroundColor: platformColor(row.platform),
              color: platformInk(row.platform),
            }}
          >
            {layerKey ? (
              <DataTypeIcon layerKey={layerKey} size={14} />
            ) : (
              <FileEarmarkSpreadsheet size={12} aria-hidden="true" />
            )}
          </span>
        }
        label={
          row.platform && row.platform !== "unknown"
            ? `${platformLabel(row.platform, i18n.language)} · ${typeLabel}`
            : typeLabel
        }
      />
      <span className="datasetCardMetaItem" title={t("coverageGroup_source")}>
        <Server size={13} aria-hidden="true" />
        {serverName}
      </span>
      {isGrid ? (
        <span
          className="datasetCardMetaItem"
          title={t("griddapGridSizeTooltip")}
        >
          <PinMapFill size={13} aria-hidden="true" />
          {gridSize}
        </span>
      ) : (
        <MetaIconItem
          icon={<PinMapFill size={13} aria-hidden="true" />}
          label={`${t("datasetsTableHeaderLocationsText")}: ${locationsCount(row, i18n.language)}`}
        >
          {locationsCount(row, i18n.language)}
        </MetaIconItem>
      )}
      {row.days != null && (
        <span
          className="datasetCardMetaItem"
          title={t("datasetsCardSortDaysText")}
        >
          <CalendarCheck size={13} aria-hidden="true" />
          {Number(row.days).toLocaleString(i18n.language)}
        </span>
      )}
    </span>
  );
}
