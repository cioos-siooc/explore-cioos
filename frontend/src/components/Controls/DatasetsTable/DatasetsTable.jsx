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
  PinMapFill
} from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import platformColors from '../../platformColors'
import './styles.css'
import DataTable from 'react-data-table-component'
import DataTableExtensions from 'react-data-table-component-extensions'
import bytes from 'bytes'

import _ from 'lodash'
import classNames from 'classnames'
import { Spinner, OverlayTrigger, Tooltip } from 'react-bootstrap'

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
  const { t } = useTranslation()
  const [tableData, setTableData] = useState({
    columns: generateColumns(),
    data: datasets
  })
  const checkBoxOnclick = (point) => () => {
    if (!isDownloadModal || point.internalDownload) {
      handleSelectDataset(point)
    }
  }
  const selectAllOnclick = (e) => {
    e.stopPropagation()
    handleSelectAllDatasets()
  }

  useEffect(() => {
    setTableData({ columns: generateColumns(), data: datasets })
  }, [datasets, downloadSizeEstimates])

  function generateColumns() {
    // const cellPadding = '0px'
    const disabledCheckboxStyle = {
      backgroundColor: 'lightgrey'
    }

    const columns = [
      {
        name: (
          <div title={t('datasetsTableDownloadModalDatasetCheckboxTooltip')}>
            {selectAll ? (
              <CheckSquare onClick={selectAllOnclick} size={16} />
            ) : (
              <Square onClick={selectAllOnclick} size={16} />
            )}
            <Download className='downloadIcon' onClick={selectAllOnclick} size={18} title={t('datasetInspectorDownloadText')} />
          </div>
        ),
        selector: (row) => row.selected,
        cell: (row) => {
          return (
            <div title={t('datasetsTableDownloadModalDatasetCheckboxTooltip')}>
              {row.selected ? (
                <CheckSquare onClick={checkBoxOnclick(row)} size={16} />
              ) : (
                <Square
                  style={
                    isDownloadModal &&
                    !row.internalDownload &&
                    disabledCheckboxStyle
                  }
                  onClick={checkBoxOnclick(row)}
                  size={16}
                />
              )}
              <Download className='downloadIcon' onClick={checkBoxOnclick(row)} size={18} />
              {/* <Download className='downloadIcon' /> */}
            </div>
          )
        },
        ignoreRowClick: true,
        sortable: true,
        width: '60px',
        // paddingLeft: cellPadding,
        // paddingRight: cellPadding
      },

      {
        name: (
          <div>
            <BroadcastPin size={20} title={t('datasetInspectorPlatformText')} />
          </div>
        ),
        // compact: true,
        wrap: true,
        center: true,
        selector: (row) => row.platform,
        cell: (point) => {
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
        width: '60px',
        // paddingLeft: cellPadding,
        // paddingRight: cellPadding
      },
      {
        name: (
          <div>
            <FileEarmarkSpreadsheet size={17} title={t('datasetsTableHeaderTitleText')} />
          </div>
        ),
        selector: (row) => row.title,
        wrap: true,
        width: '280px',
        sortable: true
      },
      {
        name: t('datasetsTableHeaderTypeText'),
        selector: (row) => row.cdm_data_type,
        cell: (row) =>
          row.cdm_data_type
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
          if (!_.isEmpty(downloadSizeEstimates)) {
            return (
              <div className='downloadSizeEstimate'>
                {!_.isEmpty(downloadSizeEstimates) && (
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
            return (
              <Spinner
                className='datasetsTableSpinner'
                as='span'
                animation='border'
                size={50}
                role='status'
                aria-hidden='true'
              />
            )
          }
        },
        wrap: true,
        sortable: true,
        width: '200px',
        // paddingLeft: cellPadding,
        // paddingRight: cellPadding
      })
      columns.push({
        name: t('datasetTableDownloadModalCDEDownloadableColumnName'),
        selector: (row) => row.internalDownload,
        cell: (row) => {
          if (!_.isEmpty(downloadSizeEstimates)) {
            return row.internalDownload ? (
              <OverlayTrigger
                placement='top'
                overlay={
                  <Tooltip>
                    {t(
                      'datasetTableDownloadModalCDEDownloadableColumnNameTooltip'
                    )}
                  </Tooltip>
                }
              >
                <Check2Circle
                  className='downloadableIcon'
                  color='#52a79b'
                  size='25'
                />
              </OverlayTrigger>
            ) : (
              <OverlayTrigger
                placement='top'
                overlay={
                  <Tooltip>
                    {t(
                      'datasetTableDownloadModalNotCDEDownloadableColumnNameTooltip'
                    )}
                  </Tooltip>
                }
              >
                <XCircle className='downloadableIcon' color='#e3285e' size='25' />
              </OverlayTrigger>
            )
          } else {
            return (
              <Spinner
                className='datasetsTableSpinner'
                as='span'
                animation='border'
                size={50}
                role='status'
                aria-hidden='true'
              />
            )
          }
        },
        wrap: true,
        sortable: true,
        width: '170px',
        // paddingLeft: cellPadding,
        // paddingRight: cellPadding
      })
      columns.push({
        name: t('datasetTableDownloadModalExternalDownloadColumnName'),
        selector: (row) => row.erddapLink,
        cell: (row) => {
          if (!_.isEmpty(downloadSizeEstimates) && row.erddapLink) {
            return (
              <a href={row.erddapLink} target='_blank' rel='noreferrer'>
                ERDDAP
              </a>
            )
          } else {
            return (
              <Spinner
                className='datasetsTableSpinner'
                as='span'
                animation='border'
                size={50}
                role='status'
                aria-hidden='true'
              />
            )
          }
        },
        wrap: true,
        sortable: true,
        width: '150px',
        // paddingLeft: cellPadding,
        // paddingRight: cellPadding
      })
    }

    return columns
  }

  return (
    <div className='datasetsTable'>
      <DataTableExtensions
        {...tableData}
        print={false}
        export={false}
        filterPlaceholder={t('datasetInspectorFilterText')}
        filter={true}
      >
        <DataTable
          striped
          columns={tableData.columns}
          data={tableData.data}
          defaultSortFieldId={3}
          onRowClicked={isDownloadModal ? undefined : setInspectDataset}
          onRowMouseEnter={setHoveredDataset}
          onRowMouseLeave={() => setHoveredDataset()}
          highlightOnHover={!isDownloadModal}
          pointerOnHover={!isDownloadModal}
          pagination={tableData.data?.length > 100}
          paginationPerPage={50}
          paginationRowsPerPageOptions={[50, 100, 150, 200]}
          paginationComponentOptions={{
            rowsPerPageText: t('tableComponentRowsPerPage'),
            rangeSeparatorText: t('tableComponentOf'),
            selectAllRowsItem: false
          }}
          // compact
          customStyles={{
            rows: {
              style: {
                minHeight: '72px', // override the row height
              },
            },
            headCells: {
              style: {
                paddingLeft: '5px', // override the cell padding for head cells
                paddingRight: '0px',
              },
            },
            cells: {
              style: {
                paddingLeft: '5px', // override the cell padding for data cells
                paddingRight: '0px',
              },
            },
          }}
        />
      </DataTableExtensions>
    </div>
  )
}
