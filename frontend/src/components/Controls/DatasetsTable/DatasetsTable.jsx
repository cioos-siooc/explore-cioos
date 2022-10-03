import React, { useEffect, useState } from 'react'
import {
  CheckSquare,
  CircleFill,
  Square,
  Check2Circle,
  XCircle
} from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import platformColors from '../../platformColors'
import './styles.css'
import DataTable from 'react-data-table-component'
import DataTableExtensions from 'react-data-table-component-extensions'
import { bytesToMemorySizeString } from '../../../utilities'
import _ from 'lodash'

export default function DatasetsTable({
  handleSelectAllDatasets,
  handleSelectDataset,
  datasets,
  selectAll,
  setInspectDataset,
  setHoveredDataset = () => { },
  isDownloadModal,
  downloadSizeEstimates
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
    const columns = [
      {
        name: selectAll ? (
          <CheckSquare onClick={selectAllOnclick} />
        ) : (
          <Square onClick={selectAllOnclick} />
        ),
        selector: (row) => row.selected,
        cell: (row) =>
          row.selected ? (
            <CheckSquare onClick={checkBoxOnclick(row)} />
          ) : (
            <Square onClick={checkBoxOnclick(row)} />
          ),
        ignoreRowClick: true,
        width: '60px',
        sortable: true
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
        sortable: true
      },
      {
        name: t('datasetsTableHeaderTitleText'),
        selector: (row) => row.title,
        wrap: true,
        width: '250px',
        sortable: true
      },
      {
        name: t('datasetsTableHeaderTypeText'),

        selector: (row) =>
          row.cdm_data_type
            .replace('TimeSeriesProfile', 'Timeseries / Profile')
            .replace('TimeSeries', 'Timeseries'),
        wrap: true,
        width: '100px',
        sortable: true,
      },
      {
        name: t('datasetsTableHeaderLocationsText'),
        selector: (row) => {
          if (row.profiles_count !== row.n_profiles) {
            return `${row.profiles_count} / ${row.n_profiles}`
          } else {
            return row.profiles_count
          }
        },
        wrap: true,
        sortable: true,
        width: '100px'
      }
    ]

    if (isDownloadModal) {
      columns.push({
        name: 'Estimated download size',
        selector: (row) => !_.isEmpty(downloadSizeEstimates) && (`${bytesToMemorySizeString(row.sizeEstimate.filteredSize)} / ${bytesToMemorySizeString(row.sizeEstimate.unfilteredSize)}`),
        wrap: true,
        sortable: true,
        width: '200px'
      })
      columns.push({
        name: 'CDE Downloadable',
        selector: (row) => !_.isEmpty(downloadSizeEstimates) && (row.internalDownload),
        cell: (row) => {
          if (!_.isEmpty(downloadSizeEstimates)) {
            return row.internalDownload ? <Check2Circle className='downloadableIcon' color='green' size='25' /> : <XCircle className='downloadableIcon' color='red' size='25' />
          }
        },
        wrap: true,
        sortable: true,
        width: '170px'
      })
      columns.push({
        name: 'External download',
        selector: (row) => !_.isEmpty(downloadSizeEstimates) && (row.erddapLink),
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
          }
        },
        wrap: true,
        sortable: true,
        width: '150px'
      })
    }

    return columns
  }

  /* TODO:
  - add number of downloadable datasets count to download
  - add section with more download details about the download that is currently setup
  - remove the size estimator
  - add the cookie for the email
  - add the 'enable' / 'disable' filter options for each filter using toggles, or using additional columns in the table
  - remove or fix the download instructions to reflect the changes that we have implemented (maybe make it an toggle to see area)
  - automatically select or deselect datasets that do/don't fit within the dataset size limitations
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
