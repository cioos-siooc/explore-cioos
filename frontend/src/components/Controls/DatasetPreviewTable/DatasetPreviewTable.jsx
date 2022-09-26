import React from 'react'

import './styles.css'
import DataTable from 'react-data-table-component'
import DataTableExtensions from 'react-data-table-component-extensions'
import { useTranslation } from 'react-i18next'
import { splitLines } from '../../../utilities'

export default function DatasetPreviewTable({ datasetPreview }) {
  if (!datasetPreview) return <div />

  const { t } = useTranslation()

  const { columnNames, columnUnits, rows } = datasetPreview.table

  // reformat datasetPreview into array of objects
  const data = rows.map((row) => {
    const keys = columnNames
    const values = row
    const merged = keys.reduce(
      (obj, key, index) => ({ ...obj, [key]: values[index] }),
      {}
    )
    return merged
  })

  const columns = columnNames.map((colName, i) => ({
    name: splitLines(
      colName + ' ' + (columnUnits[i] ? `(${columnUnits[i]})` : '')
    ),
    selector: colName,
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
      exportHeaders
      highlightOnHover={false}
      filterPlaceholder={t('datasetInspectorFilterText')}
    >
      <DataTable
        striped
        columns={columns}
        data={data}
        pagination
        highlightOnHover
      />
    </DataTableExtensions>
  )
}
