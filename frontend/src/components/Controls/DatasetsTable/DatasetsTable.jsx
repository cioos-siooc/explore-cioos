import { toInteger, toNumber } from 'lodash'
import * as React from 'react'
import { Table } from 'react-bootstrap'
import { CheckSquare, ChevronCompactRight, Square } from 'react-bootstrap-icons'
import { abbreviateString, bytesToMemorySizeString } from '../../../utilities'

import './styles.css'

export default function DatasetsTable({ handleSelectAllDatasets, handleSelectDataset, datasets, selectAll, setInspectDataset }) {

  const totalWidth = 560

  const checkColWidth = 40
  const titleColWidth = 145
  const typeColWidth = 150
  const pointsColWidth = 65
  const sizeColWidth = 80
  const openButtonColWidth = 70

  return (
    <div className='datasetsTable' style={{ width: `${totalWidth}px` }}>
      <Table striped hover>
        <thead>
          <tr>
            <th style={{ width: `${checkColWidth}px`, maxWidth: `${checkColWidth}px` }} title='Select all' onClick={() => handleSelectAllDatasets()}>{selectAll ? <CheckSquare /> : <Square />}</th>
            <th style={{ width: `${titleColWidth}px`, maxWidth: `${titleColWidth}px` }} title='Sort by dataset title'>Title</th>
            <th style={{ width: `${typeColWidth}px`, maxWidth: `${typeColWidth}px` }} title='Sort by dataset type'>Type</th>
            <th style={{ width: `${pointsColWidth}px`, maxWidth: `${pointsColWidth}px` }} title='Sort by number of points in dataset'>Points</th>
            <th style={{ width: `${sizeColWidth}px`, maxWidth: `${sizeColWidth}px` }} title='Sort by approximate dataset size in megabytes'>Size</th>
            <th style={{ width: `${openButtonColWidth}px`, maxWidth: `${openButtonColWidth}px` }} title='Open dataset details'>Details</th>
          </tr>
        </thead>
        <tbody>
          {datasets.map((point, index) => {
            // { console.log('dataset size, bytes', point.size, point) }
            return (
              <tr key={index}>
                <td style={{ width: `${checkColWidth}px`, maxWidth: `${checkColWidth}px`, wordWrap: 'break-word' }} onClick={() => handleSelectDataset(point)} title='Select dataset for download'>{point.selected ? <CheckSquare /> : <Square />}</td>
                <td style={{ width: `${titleColWidth}px`, maxWidth: `${titleColWidth}px`, wordWrap: 'break-word' }} title={point.title}>{abbreviateString(point.title, 40)}</td>
                <td style={{ width: `${typeColWidth}px`, maxWidth: `${typeColWidth}px`, wordWrap: 'break-word' }} title='Dataset type'>{point.cdm_data_type}</td>
                <td style={{ width: `${pointsColWidth}px`, maxWidth: `${pointsColWidth}px`, wordWrap: 'break-word' }} title='Number of points in dataset'>{point.profiles.length}</td>
                <td style={{ width: `${sizeColWidth}px`, maxWidth: `${sizeColWidth}px`, wordWrap: 'break-word' }} title='Approximate dataset size in megabytes'>{bytesToMemorySizeString(point.size)}</td>
                <td style={{ width: `${openButtonColWidth}px`, maxWidth: `${openButtonColWidth}px`, wordWrap: 'break-word' }} onClick={() => setInspectDataset(point)} title='Open dataset details'>
                  <div className='inspectButton'><ChevronCompactRight /></div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </Table>
    </div>
  )
}