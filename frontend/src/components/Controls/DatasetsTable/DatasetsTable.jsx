import * as React from 'react'
import {
  CheckSquare,
  CircleFill,
  Square
} from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import platformColors from '../../platformColors'
import './styles.css'
import DataTable from 'react-data-table-component'
import DataTableExtensions from 'react-data-table-component-extensions'

export default function DatasetsTable({
  handleSelectAllDatasets,
  handleSelectDataset,
  datasets,
  selectAll,
  setInspectDataset,
  isDownloadModal,
  setHoveredDataset = () => { }
}) {
  const { t } = useTranslation()

  const checkBoxOnclick = (point) => () => handleSelectDataset(point)
  const selectAllOnclick = (e) => {
    e.stopPropagation()
    handleSelectAllDatasets()
  }

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
      sortable: false
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
      sortable: true
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

  const data = datasets

  const tableData = {
    columns,
    data
  }

  return (
    <div className='datasetsTable'>
      <DataTableExtensions
        {...tableData}
        print={false}
        export={false}
        filterPlaceholder={t('datasetInspectorFilterText')}
        filter={!isDownloadModal}
      >
        <DataTable
          striped
          columns={columns}
          data={data}
          defaultSortFieldId={3}
          onRowClicked={isDownloadModal ? undefined : setInspectDataset}
          onRowMouseEnter={setHoveredDataset}
          highlightOnHover={!isDownloadModal}
          pointerOnHover={!isDownloadModal}
          pagination={data?.length > 100}
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
