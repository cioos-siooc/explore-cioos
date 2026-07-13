import React, { useEffect, useState } from 'react'
import {
  CheckSquare,
  CircleFill,
  Square,
  Check2Circle,
  XCircle,
  Download,
  BroadcastPin,
  FileEarmarkSpreadsheet,
  Grid3x3Gap,
  PinMapFill,
  Search,
  Server
} from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import platformColors from '../../platformColors'
import { formatErddapServerName } from '../../../utilities'
import { formatGridSize } from '../../../wmsUtilities'
import erddapServersJSONfile from '../../../erddapServers.json'
import './styles.css'
import DataTable from 'react-data-table-component'
import bytes from 'bytes'
import isEmpty from 'lodash/isEmpty'

import classNames from 'classnames'
import Spinner from '../../ui/Spinner.jsx'
import Tooltip from '../../ui/Tooltip.jsx'

export default function DatasetsTable({
  handleSelectAllDatasets,
  handleSelectDataset,
  datasets,
  selectAll,
  setInspectDataset,
  setHoveredDataset = () => { },
  isDownloadModal,
  downloadSizeEstimates,
  loading
}) {
  const { t, i18n } = useTranslation()
  const [searchText, setSearchText] = useState('')
  const isGrid = (row) => row.cdm_data_type === 'Grid'
  const checkBoxOnclick = (point) => () => {
    // griddap datasets are metadata-only: never selectable for download
    if ((!isDownloadModal || point.internalDownload) && !isGrid(point)) {
      handleSelectDataset(point)
    }
  }
  const selectAllOnclick = (e) => {
    e.stopPropagation()
    handleSelectAllDatasets()
  }
  // generateColumns closes over the handlers above — keep this initializer
  // after them, or the download-modal header JSX hits their TDZ.
  const [tableData, setTableData] = useState({
    columns: generateColumns(),
    data: datasets
  })

  // Sidebar search: filter across the visible text fields. The download
  // modal has no search UI, so this is a no-op there.
  function filterBySearch(rows) {
    if (isDownloadModal || isEmpty(searchText)) return rows
    const query = searchText.toLowerCase()
    return (rows || []).filter((row) =>
      [
        row.title,
        row.cdm_data_type,
        formatErddapServerName(
          row.erddap_server_url || row.erddap_url,
          i18n.language,
          erddapServersJSONfile
        )
      ]
        .join(' ')
        .toLowerCase()
        .includes(query)
    )
  }

  useEffect(() => {
    setTableData({ columns: generateColumns(), data: filterBySearch(datasets) })
  }, [datasets, downloadSizeEstimates, searchText])

  function generateColumns() {
    const columns = [
      {
        // Sidebar moves "select all" into the search toolbar and keeps just the
        // download icon as the column header; the download modal keeps it inline.
        name: isDownloadModal ? (
          <div title={t('datasetsTableDownloadModalDatasetCheckboxTooltip')}>
            {selectAll ? (
              <CheckSquare onClick={selectAllOnclick} size={16} />
            ) : (
              <Square onClick={selectAllOnclick} size={16} />
            )}
            <Download className='downloadIcon' onClick={selectAllOnclick} size={18} title={t('datasetInspectorDownloadText')} />
          </div>
        ) : (
          <Download size={18} title={t('datasetInspectorDownloadText')} />
        ),
        selector: (row) => row.selected,
        cell: (row) => {
          return (
            <div
              title={
                isGrid(row)
                  ? t('griddapNotDownloadableTooltip')
                  : t('datasetsTableDownloadModalDatasetCheckboxTooltip')
              }
            >
              {row.selected ? (
                <CheckSquare
                  className='datasetCheckbox checked'
                  onClick={checkBoxOnclick(row)}
                  size={16}
                />
              ) : (
                <Square
                  className={classNames('datasetCheckbox', {
                    disabled:
                      (isDownloadModal && !row.internalDownload) || isGrid(row)
                  })}
                  onClick={checkBoxOnclick(row)}
                  size={16}
                />
              )}
            </div>
          )
        },
        ignoreRowClick: true,
        sortable: true,
        width: '40px',
        // paddingLeft: cellPadding,
        // paddingRight: cellPadding
      },

      {
        name: (
          <div>
            <BroadcastPin size={20} title={t('datasetInspectorPlatformText')} />
          </div>
        ),
        compact: true,
        center: true,
        selector: (row) => row.platform,
        cell: (point) => {
          if (isGrid(point)) {
            return (
              <Grid3x3Gap
                title={t('griddapTypeLabel')}
                className='optionColorCircle'
                color='#52a79b'
                size={15}
              />
            )
          }
          const platformColor = platformColors.find(
            (pc) => pc.platform === point.platform
          )

          return (
            <CircleFill
              title={t(point.platform)}
              className='optionColorCircle'
              fill={platformColor?.color || '#000000'}
              size={15}
            />
          )
        },
        sortable: true,
        width: '40px',
        // paddingLeft: cellPadding,
        // paddingRight: cellPadding
      },
      {
        name: (
          <div>
            <Server size={17} title='ERDDAP Server' />
          </div>
        ),
        selector: (row) => row.erddap_server_url || row.erddap_url,
        cell: (row) => formatErddapServerName(row.erddap_server_url || row.erddap_url, i18n.language, erddapServersJSONfile),
        wrap: true,
        sortable: true,
        // Flex (minWidth + grow) rather than a fixed width in both contexts so
        // columns share the available width instead of summing past it and
        // forcing a horizontal scrollbar.
        minWidth: isDownloadModal ? '100px' : '80px',
        grow: 1
      },
      {
        name: (
          <div>
            <FileEarmarkSpreadsheet size={17} title={t('datasetsTableHeaderTitleText')} />
          </div>
        ),
        selector: (row) => row.title,
        wrap: true,
        sortable: true,
        // Title takes the lion's share of the remaining space.
        minWidth: isDownloadModal ? '160px' : '140px',
        grow: 3
      },
      {
        name: t('datasetsTableHeaderTypeText'),
        selector: (row) => row.cdm_data_type,
        cell: (row) =>
          isGrid(row)
            ? t('griddapTypeLabel')
            : row.cdm_data_type
              .replace('TimeSeriesProfile', 'Time series / Profile')
              .replace('TimeSeries', 'Time series'),
        wrap: true,
        sortable: true,
        width: '80px',
        // paddingLeft: cellPadding,
        // paddingRight: cellPadding
      },
      {
        name: (
          <div>
            <PinMapFill size={18} title={t('datasetsTableHeaderLocationsText')} />
          </div>
        ),
        selector: (row) => row.profiles_count,
        cell: (row) => {
          if (isGrid(row)) {
            // grid size (lon × lat nodes) instead of a locations count
            return (
              <span title={t('griddapGridSizeTooltip')}>
                {formatGridSize(row.grid_dimensions) || '—'}
              </span>
            )
          }
          if (row.profiles_count !== row.n_profiles) {
            return `${row.profiles_count} / ${row.n_profiles}`
          } else {
            return row.profiles_count
          }
        },
        wrap: true,
        sortable: true,
        width: '60px',
        // paddingLeft: cellPadding,
        // paddingRight: cellPadding
      }
    ]

    if (isDownloadModal) {
      columns.push({
        name: t('datasetsTableDownloadModalEstimateDownloadSizeColumnName'),
        selector: (row) => row.sizeEstimate.filteredSize,
        cell: (row) => {
          const estimatedFilteredDownloadSizeRowClassName = classNames(
            'downloadSizeEstimateFiltered',
            { downloadable: row?.sizeEstimate?.filteredSize < 1000000000 }
          )
          if (!isEmpty(downloadSizeEstimates)) {
            return (
              <div className='downloadSizeEstimate'>
                {!isEmpty(downloadSizeEstimates) && (
                  <>
                    <div className={estimatedFilteredDownloadSizeRowClassName}>
                      {bytes(row?.sizeEstimate?.filteredSize)}
                    </div>
                    {` / ${bytes(row?.sizeEstimate?.unfilteredSize)}`}
                  </>
                )}
              </div>
            )
          } else {
            return <Spinner className='datasetsTableSpinner' />
          }
        },
        wrap: true,
        sortable: true,
        minWidth: '140px',
        grow: 1
      })
      columns.push({
        name: t('datasetTableDownloadModalCDEDownloadableColumnName'),
        selector: (row) => row.internalDownload,
        cell: (row) => {
          if (!isEmpty(downloadSizeEstimates)) {
            return row.internalDownload ? (
              <Tooltip
                placement='top'
                content={t(
                  'datasetTableDownloadModalCDEDownloadableColumnNameTooltip'
                )}
              >
                <Check2Circle
                  className='downloadableIcon success'
                  size='25'
                />
              </Tooltip>
            ) : (
              <Tooltip
                placement='top'
                content={t(
                  'datasetTableDownloadModalNotCDEDownloadableColumnNameTooltip'
                )}
              >
                <XCircle className='downloadableIcon error' size='25' />
              </Tooltip>
            )
          } else {
            return <Spinner className='datasetsTableSpinner' />
          }
        },
        wrap: true,
        sortable: true,
        width: '90px',
        center: true
      })
      columns.push({
        name: t('datasetTableDownloadModalExternalDownloadColumnName'),
        selector: (row) => row.erddapLink,
        cell: (row) => {
          if (!isEmpty(downloadSizeEstimates) && row.erddapLink) {
            return (
              <a href={row.erddapLink} target='_blank' rel='noreferrer'>
                ERDDAP
              </a>
            )
          } else {
            return <Spinner className='datasetsTableSpinner' />
          }
        },
        wrap: true,
        sortable: true,
        width: '80px',
        center: true
      })
    }

    return columns
  }

  // Sidebar toolbar: full-width search input with the "select all" toggle
  // pulled in alongside it (replaces the cramped DataTableExtensions filter),
  // plus a live count of the rows currently listed.
  const sidebarToolbar = (
    <div className='datasetsTableToolbar'>
      <button
        type='button'
        className={classNames('selectAllToggle', { active: selectAll })}
        onClick={selectAllOnclick}
        aria-pressed={selectAll}
        title={t('datasetsTableHeaderSelectAllTitle')}
      >
        {t('datasetsTableHeaderSelectAllTitle')}
      </button>
      <div className='datasetsTableSearchWrap'>
        <Search size={13} aria-hidden='true' />
        <input
          className='datasetsTableSearch'
          type='text'
          value={searchText}
          placeholder={t('datasetInspectorFilterText')}
          onChange={(e) => setSearchText(e.target.value)}
        />
      </div>
      <span className='datasetsTableCount'>{tableData.data?.length || 0}</span>
    </div>
  )

  // Design-token driven table chrome: quiet sand header with small-caps
  // labels, hairline row dividers, and a teal inset accent on hover
  // (box-shadow, so the row doesn't shift like a border would).
  const tableStyles = {
    headRow: {
      style: {
        minHeight: '38px',
        backgroundColor: 'var(--cioos-sand)',
        borderBottomColor: 'var(--cioos-hairline)'
      }
    },
    headCells: {
      style: {
        paddingLeft: '8px',
        paddingRight: '4px',
        fontFamily: 'var(--cioos-font-display)',
        fontSize: '11px',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: 'var(--cioos-ink-60)'
      }
    },
    rows: {
      style: {
        minHeight: '52px',
        fontSize: 'var(--cioos-font-size-base)',
        color: 'var(--cioos-ink)',
        '&:not(:last-of-type)': {
          borderBottomColor: 'var(--cioos-hairline)'
        }
      },
      highlightOnHoverStyle: {
        backgroundColor: 'var(--cioos-surface-2)',
        borderBottomColor: 'var(--cioos-hairline)',
        outline: 'none',
        boxShadow: 'inset 3px 0 0 var(--cioos-primary)'
      }
    },
    cells: {
      style: {
        paddingLeft: '8px',
        paddingRight: '4px'
      }
    },
    subHeader: {
      style: {
        padding: '8px 10px',
        borderBottom: '1px solid var(--cioos-hairline)'
      }
    },
    pagination: {
      style: {
        minHeight: '44px',
        borderTopColor: 'var(--cioos-hairline)',
        color: 'var(--cioos-ink-60)',
        fontSize: 'var(--cioos-font-size-sm)'
      }
    }
  }

  // Rows already picked for download get a light teal wash so the current
  // selection is scannable without hunting for checkboxes.
  const selectedRowStyles = [
    {
      when: (row) => row.selected,
      style: { backgroundColor: 'rgba(198, 227, 223, 0.35)' }
    }
  ]

  const table = (
    <DataTable
      columns={tableData.columns}
      data={tableData.data}
      defaultSortFieldId={3}
      onRowClicked={isDownloadModal ? undefined : setInspectDataset}
      onRowMouseEnter={setHoveredDataset}
      onRowMouseLeave={() => setHoveredDataset()}
      highlightOnHover={!isDownloadModal}
      pointerOnHover={!isDownloadModal}
      subHeader={!isDownloadModal}
      subHeaderAlign='center'
      subHeaderComponent={!isDownloadModal ? sidebarToolbar : undefined}
      pagination={tableData.data?.length > 100}
      paginationPerPage={50}
      paginationRowsPerPageOptions={[50, 100, 150, 200]}
      paginationComponentOptions={{
        rowsPerPageText: t('tableComponentRowsPerPage'),
        rangeSeparatorText: t('tableComponentOf'),
        selectAllRowsItem: false
      }}
      customStyles={tableStyles}
      conditionalRowStyles={selectedRowStyles}
      // Fill the panel's full height: toolbar/subheader and pagination stay
      // put; only this scroll area (targeted by className, see styles.css)
      // grows into the remaining space and scrolls, with a sticky header.
      className='dtScrollArea'
      fixedHeader
      fixedHeaderScrollHeight='100%'
    />
  )

  return <div className='datasetsTable'>{table}</div>
}
