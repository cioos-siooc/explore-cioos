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
import { bytesToMemorySizeString } from '../../../utilities'
import _ from 'lodash'
import classNames from 'classnames'
import { Spinner } from 'react-bootstrap'

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
  const [tableData, setTableData] = useState({ columns: generateColumns(), data: datasets })
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
        name: <div title={'Download from CIOOS Data Explorer'}>
          {selectAll ? (
            <CheckSquare onClick={selectAllOnclick} />
          ) : (
            <Square onClick={selectAllOnclick} />
          )}
          <Download className='downloadIcon' onClick={selectAllOnclick} />
        </div>
        ,
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
        }
        ,
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
        name: 'Estimated download size',
        selector: (row) => row.sizeEstimate.filteredSize,
        cell: (row) => {
          const estimatedFilteredDownloadSizeRowClassName = classNames('downloadSizeEstimateFiltered', { downloadable: row?.sizeEstimate?.filteredSize < 1000000000 })
          if (!_.isEmpty(downloadSizeEstimates)) {
            return (
              <div className='downloadSizeEstimate'>
                {!_.isEmpty(downloadSizeEstimates) && (
                  <>
                    <div className={estimatedFilteredDownloadSizeRowClassName}>{bytesToMemorySizeString(row?.sizeEstimate?.filteredSize)}</div>
                    {` / ${bytesToMemorySizeString(row?.sizeEstimate?.unfilteredSize)}`}
                  </>
                )}
              </div>
            )
          } else {
            return (<Spinner
              className='datasetsTableSpinner'
              as='span'
              animation='border'
              size={50}
              role='status'
              aria-hidden='true' />)
          }
        },
        wrap: true,
        sortable: true,
        width: '200px',
        paddingLeft: cellPadding,
        paddingRight: cellPadding
      })
      columns.push({
        name: 'CDE Downloadable',
        selector: (row) => row.internalDownload,
        cell: (row) => {
          if (!_.isEmpty(downloadSizeEstimates)) {
            return row.internalDownload ? <Check2Circle className='downloadableIcon' color='green' size='25' /> : <XCircle className='downloadableIcon' color='red' size='25' />
          } else {
            return (<Spinner
              className='datasetsTableSpinner'
              as='span'
              animation='border'
              size={50}
              role='status'
              aria-hidden='true' />)
          }
        },
        wrap: true,
        sortable: true,
        width: '170px',
        paddingLeft: cellPadding,
        paddingRight: cellPadding
      })
      columns.push({
        name: 'External download',
        selector: (row) => row.erddapLink,
        cell: (row) => {
          if (!_.isEmpty(downloadSizeEstimates) && row.erddapLink) {
            return (
              <a
                href={row.erddapLink}
                target='_blank' rel='noreferrer'
              >
                ERDDAP
              </a>
            )
          } else {
            return (<Spinner
              className='datasetsTableSpinner'
              as='span'
              animation='border'
              size={50}
              role='status'
              aria-hidden='true' />)
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

  /* TODO:
- add number of downloadable datasets count to download
- add section with more download details about the download that is currently setup
- add the cookie for the email
- remove or fix the download instructions to reflect the changes that we have implemented (maybe make it an toggle to see area)
*/

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
