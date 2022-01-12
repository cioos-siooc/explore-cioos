import * as React from 'react'
import { Table } from 'react-bootstrap'
import { CheckSquare, Square } from 'react-bootstrap-icons'

import './styles.css'

export default function DatasetsTable({ handleSelectAllDatasets, handleSelectDataset, datasets, selectAll, children }) {

  const checkColWidth = '33px'
  const titleColWidth = '171px'
  const typeColWidth = '100px'
  const pointsColWidth = '65px'
  const sizeColWidth = '80px'

  return (
    <div className='datasetsTable'>
      <Table striped hover>
        <thead>
          <tr>
            <th style={{ "width": checkColWidth }} title='Select all' onClick={() => handleSelectAllDatasets()}>{selectAll ? <CheckSquare /> : <Square />}</th>
            <th style={{ "width": titleColWidth }} title='Sort by dataset title'>Title</th>
            <th style={{ "width": typeColWidth }} title='Sort by dataset type'>Type</th>
            <th style={{ "width": pointsColWidth }} title='Sort by number of points in dataset'>Points</th>
            <th style={{ "width": sizeColWidth }} title='Sort by approximate dataset size in megabytes'>Size</th>
          </tr>
        </thead>
        <tbody>
          {datasets.map((point, index) => {
            return (
              <tr key={index} onClick={() => { }} title='Open dataset details'>
                <td style={{ "width": checkColWidth }} onClick={() => handleSelectDataset(point)} title='Select dataset for download'>{point.selected ? <CheckSquare /> : <Square />}</td>
                <td style={{ "width": titleColWidth }} title='Dataset title'>{point.title}</td>
                <td style={{ "width": typeColWidth }} title='Dataset type'>A/B/C/D</td>
                <td style={{ "width": pointsColWidth }} title='Number of points in dataset'>{point.profiles.length}</td>
                <td style={{ "width": sizeColWidth }} title='Approximate dataset size in megabytes'>{Math.floor(point.profiles.length * 0.1)} MB</td>
              </tr>
            )
          })}
        </tbody>
      </Table>
    </div>
  )
}