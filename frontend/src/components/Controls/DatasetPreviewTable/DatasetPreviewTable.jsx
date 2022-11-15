import React from 'react'

import './styles.css'
import DataTable from 'react-data-table-component'
import DataTableExtensions from 'react-data-table-component-extensions'
import { useTranslation } from 'react-i18next'
import { splitLines } from '../../../utilities'

export default function DatasetPreviewTable({ datasetPreview, data }) {
  if (!datasetPreview) return <div />

  const { t } = useTranslation()

  const { columnNames, columnUnits } = datasetPreview.table || {
    rows: [],
    columnNames: []
  }

  const columns = columnNames.map((colName, i) => ({
    name: splitLines(
      colName + ' ' + (columnUnits[i] ? `(${columnUnits[i]})` : '')
    ),
    selector: (row) => row[colName],
    reorder: true,
    wrap: true,
    sortable: true
  }))

  const tableData = {
    columns,
    data
  }

  return (
    <DataTableExtensions
      {...tableData}
      print={false}
      export={false}
      filterPlaceholder={t('datasetInspectorFilterText')}
    >
      <DataTable
        striped
        columns={columns}
        data={data}
        pagination={data?.length > 10}
        paginationPerPage={10}
        paginationRowsPerPageOptions={[10, 100, 150, 200, 250]}
        paginationComponentOptions={{
          rowsPerPageText: t('tableComponentRowsPerPage'),
          rangeSeparatorText: t('tableComponentOf'),
          selectAllRowsItem: false
        }}
        dense
      />
    </DataTableExtensions>
  )
}
