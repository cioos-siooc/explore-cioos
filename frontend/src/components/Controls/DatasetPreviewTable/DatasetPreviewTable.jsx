import React, { useEffect } from 'react'
import { Table } from 'react-bootstrap'

import './styles.css'

export default function DatasetPreviewTable({ datasetPreview, setRecordLoading }) {
  // useEffect(() => {
  //   setRecordLoading(false)
  // })

  return (
    <div className='datasetPreviewTable'>
      {datasetPreview
        ?
        <Table striped bordered size="sm">
          <thead>
            <tr>
              {datasetPreview?.table?.columnNames.map((columnName, columnIndex) => {
                return <th key={columnIndex}>{columnName}</th>
              })}
            </tr>
            <tr>
              {datasetPreview?.table?.columnTypes.map((columnType, columnIndex) => {
                return <th key={columnIndex}>{columnType}</th>
              })}
            </tr>
            <tr>
              {datasetPreview?.table?.columnUnits.map((columnUnits, columnIndex) => {
                return <th key={columnIndex}>{columnUnits}</th>
              })}
            </tr>
          </thead>
          <tbody>
            {datasetPreview?.table?.rows.map((row, rowIndex) => {
              return <tr key={rowIndex}>
                {row.map((elem, elemKey) => {
                  return <td key={elemKey}>{elem}</td>
                })}
              </tr>
            })}
          </tbody>
        </Table>
        :
        <div>Please select a record to view data</div>
      }
    </div>
  )
}
