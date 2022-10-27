import React, { useEffect, useState } from 'react'
import {
  CheckSquare,
  CircleFill,
  Square,
  Check2Circle,
  XCircle,
  Download
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
    const cellPadding = '4px'
    const columns = [
      {
        name: (
          <div title={'Download from CIOOS Data Explorer'}>
            {selectAll ? (
              <CheckSquare onClick={selectAllOnclick} />
            ) : (
              <Square onClick={selectAllOnclick} />
            )}
            <Download className='downloadIcon' onClick={selectAllOnclick} />
          </div>
        ),
        selector: (row) => row.selected,
        cell: (row) => {
          return (
            <div title={'Download from CIOOS Data Explorer'}>
              {row.selected ? (
                <CheckSquare onClick={checkBoxOnclick(row)} />
              ) : (
                <Square onClick={checkBoxOnclick(row)} />
              )}
              {/* <Download className='downloadIcon' /> */}
            </div>
          )
        },
        ignoreRowClick: true,
        width: '80px',
        sortable: true,
        paddingLeft: cellPadding,
        paddingRight: cellPadding
      },

      {
        name: <div>{t('datasetInspectorPlatformText')}</div>,
        compact: true,
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
        width: '60px',
        sortable: true,
        paddingLeft: cellPadding,
        paddingRight: cellPadding
      },
      {
        name: t('datasetsTableHeaderTitleText'),
        selector: (row) => row.title,
        wrap: true,
        width: '220px',
        sortable: true
      },
      {
        name: t('datasetsTableHeaderTypeText'),
        selector: (row) => row.cdm_data_type,
        cell: (row) =>
          row.cdm_data_type
            .replace('TimeSeriesProfile', 'Timeseries / Profile')
            .replace('TimeSeries', 'Timeseries'),
        wrap: true,
        width: '100px',
        sortable: true,
        paddingLeft: cellPadding,
        paddingRight: cellPadding
      },
      {
        name: t('datasetsTableHeaderLocationsText'),
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
        width: '100px',
        paddingLeft: cellPadding,
        paddingRight: cellPadding
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
        paddingLeft: cellPadding,
        paddingRight: cellPadding
      })
      columns.push({
        name: t('datasetTableDownloadModalCDEDownloadableColumnName'),
        selector: (row) => row.internalDownload,
        cell: (row) => {
          if (!_.isEmpty(downloadSizeEstimates)) {
            return row.internalDownload ? (
              <OverlayTrigger
                placement='top'
                overlay={<Tooltip>Requests for less than 1GB of data from a dataset can be downloaded through CDE</Tooltip>}
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
                overlay={<Tooltip>Requests for more than 1GB of data from a dataset can be downloaded through the provided ERDDAP link</Tooltip>}
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
        paddingLeft: cellPadding,
        paddingRight: cellPadding
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
        paddingLeft: cellPadding,
        paddingRight: cellPadding
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
        />
      </DataTableExtensions>
    </div>
  )
}
