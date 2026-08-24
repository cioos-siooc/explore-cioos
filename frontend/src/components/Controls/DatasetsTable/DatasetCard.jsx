import React from 'react'
import {
  CheckCircleFill,
  CircleFill,
  Grid3x3Gap,
  Check2Circle,
  Plus,
  XCircle,
  Server,
  PinMapFill,
  FileEarmarkSpreadsheet
} from 'react-bootstrap-icons'
import classNames from 'classnames'
import bytes from 'bytes'
import isEmpty from 'lodash/isEmpty'

import platformColors from '../../platformColors'
import { formatErddapServerName } from '../../../utilities'
import { formatGridSize } from '../../../wmsUtilities'
import erddapServersJSONfile from '../../../erddapServers.json'
import Spinner from '../../ui/Spinner.jsx'
import Tooltip from '../../ui/Tooltip.jsx'

// A single dataset rendered as a card. Shared shell for the sidebar list and
// the download-review modal; the modal variant (isDownloadModal) adds the
// size estimate, CDE-downloadable status and external ERDDAP link.
export default function DatasetCard({
  row,
  isDownloadModal,
  downloadSizeEstimates,
  estimatesLoading,
  onSelect,
  onInspect,
  onHover = () => { },
  onHoverEnd = () => { },
  // The card's group is hidden from the map: the dataset stays in the list
  // (and downloadable), so it's dimmed rather than dropped.
  hiddenFromMap,
  // This dataset is one the last map click found. It has already been sorted to
  // the top of the list; the accent is what says why it is up there, so the
  // reordering reads as an answer rather than as the list having shuffled
  // itself.
  fromMapClick,
  t,
  i18n
}) {
  const isGrid = row.cdm_data_type === 'Grid'
  // griddap is metadata-only, and in the modal a dataset is only selectable
  // when the CDE can deliver it (internalDownload).
  const selectDisabled = isGrid || (isDownloadModal && !row.internalDownload)
  const estimatesReady = !isEmpty(downloadSizeEstimates)
  // Estimates that failed to load: the size and download status are unknown,
  // and no amount of waiting will produce them — say so instead of spinning.
  const estimatesFailed = !estimatesLoading && !estimatesReady

  const handleSelect = (e) => {
    e.stopPropagation()
    if (!selectDisabled) onSelect(row)
  }

  const clickable = typeof onInspect === 'function'
  const handleCardClick = clickable ? () => onInspect(row) : undefined
  const handleKeyDown = clickable
    ? (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onInspect(row)
      }
    }
    : undefined

  const platformColor = platformColors.find((pc) => pc.platform === row.platform)

  const serverName = formatErddapServerName(
    row.erddap_server_url || row.erddap_url,
    i18n.language,
    erddapServersJSONfile
  )

  const typeLabel = isGrid
    ? t('griddapTypeLabel')
    : (row.cdm_data_type || '')
      .replace('TimeSeriesProfile', 'Time series / Profile')
      .replace('TimeSeries', 'Time series')

  const locationsLabel = isGrid
    ? formatGridSize(row.grid_dimensions) || '—'
    : row.profiles_count !== row.n_profiles
      ? `${row.profiles_count} / ${row.n_profiles}`
      : row.profiles_count

  const selectTitle = isGrid
    ? t('griddapNotDownloadableTooltip')
    : t('datasetsTableDownloadModalDatasetCheckboxTooltip')

  return (
    <div
      className={classNames('datasetCard', {
        selected: row.selected,
        clickable,
        downloadModal: isDownloadModal,
        hiddenFromMap,
        fromMapClick
      })}
      title={fromMapClick ? t('datasetCardFromMapTitle') : undefined}
      onClick={handleCardClick}
      onMouseEnter={() => onHover(row)}
      onMouseLeave={() => onHoverEnd()}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={handleKeyDown}
    >
      {/* Add-to-download. A plus that becomes a tick, in the card's bottom-right
          corner — the same control, in the same two states, as the "+" in the
          map's "what's here" card, so adding a dataset looks the same wherever
          you do it. It replaces a hover-revealed circle-and-label badge on the
          top-left: that one was invisible at rest on a mouse, so which rows
          were in the download could not be read off the list at a glance, which
          is the one thing this control has to answer. */}
      <button
        type='button'
        className={classNames('datasetCardAdd', { checked: row.selected })}
        title={selectTitle}
        onClick={handleSelect}
        disabled={selectDisabled}
        aria-pressed={Boolean(row.selected)}
        aria-label={t('datasetsCardSelectForDownloadText')}
      >
        {row.selected ? (
          <CheckCircleFill size={17} aria-hidden='true' />
        ) : (
          <Plus size={18} aria-hidden='true' />
        )}
      </button>

      <div className='datasetCardBody'>
        <div className='datasetCardHeadline'>
          {/* The wrapper is the height of the title's first line, so the dot
              stays centered on that line however the title wraps. */}
          <span className='datasetCardPlatform'>
            {isGrid ? (
              <Grid3x3Gap
                title={t('griddapTypeLabel')}
                color='#52a79b'
                size={15}
              />
            ) : (
              <CircleFill
                title={t(row.platform)}
                fill={platformColor?.color || '#000000'}
                size={13}
              />
            )}
          </span>
          <span className='datasetCardTitle' title={row.title}>
            {row.title}
          </span>
        </div>

        <div className='datasetCardMeta'>
          <span className='datasetCardMetaItem' title='ERDDAP™ Server'>
            <Server size={13} aria-hidden='true' />
            {serverName}
          </span>
          <span className='datasetCardMetaItem' title={t('datasetsTableHeaderTypeText')}>
            <FileEarmarkSpreadsheet size={13} aria-hidden='true' />
            {typeLabel}
          </span>
          <span
            className='datasetCardMetaItem'
            title={
              isGrid
                ? t('griddapGridSizeTooltip')
                : t('datasetsTableHeaderLocationsText')
            }
          >
            <PinMapFill size={13} aria-hidden='true' />
            {locationsLabel}
          </span>
        </div>

        {isDownloadModal && (
          <div className='datasetCardDownloadInfo'>
            {estimatesReady ? (
              <>
                <span className='datasetCardSize'>
                  <span
                    className={classNames('datasetCardSizePill', {
                      downloadable: row?.sizeEstimate?.filteredSize < 1000000000
                    })}
                  >
                    {bytes(row?.sizeEstimate?.filteredSize)}
                  </span>
                  {row?.sizeEstimate?.filteredSize !==
                    row?.sizeEstimate?.unfilteredSize &&
                    ` / ${bytes(row?.sizeEstimate?.unfilteredSize)}`}
                </span>
                {row.internalDownload ? (
                  <Tooltip
                    placement='top'
                    content={t('datasetTableDownloadModalCDEDownloadableColumnNameTooltip')}
                  >
                    <span className='datasetCardStatus'>
                      <Check2Circle className='downloadableIcon success' size={18} />
                      {t('datasetsCardSortDownloadableText')}
                    </span>
                  </Tooltip>
                ) : (
                  <Tooltip
                    placement='top'
                    content={t('datasetTableDownloadModalNotCDEDownloadableColumnNameTooltip')}
                  >
                    <span className='datasetCardStatus'>
                      <XCircle className='downloadableIcon error' size={18} />
                      {row.erddapLink ? (
                        <a
                          href={row.erddapLink}
                          target='_blank'
                          rel='noreferrer'
                          onClick={(e) => e.stopPropagation()}
                        >
                          ERDDAP™
                        </a>
                      ) : (
                        t('datasetTableDownloadModalExternalDownloadColumnName')
                      )}
                    </span>
                  </Tooltip>
                )}
              </>
            ) : estimatesFailed ? (
              <span className='datasetCardSizeUnavailable'>
                {t('downloadSizeUnavailableTitle')}
              </span>
            ) : (
              <Spinner className='datasetsTableSpinner' />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
