import * as React from 'react'
import { useState, useEffect } from 'react'
import { Container, Table, Row, Col, ProgressBar } from 'react-bootstrap'
import { CheckSquare, Square } from 'react-bootstrap-icons'

import { server } from '../../../config'

import './styles.css'

export default function PointDetails({ pointPKs, setPointsToDownload }) {
  const [selectAll, setSelectAll] = useState(true)
  const [pointsData, setPointsData] = useState([])
  const [selectedDataset, setSelectedDataset] = useState()

  const checkColWidth = '33px'
  const titleColWidth = '171px'
  const typeColWidth = '100px'
  const pointsColWidth = '65px'
  const sizeColWidth = '80px'

  useEffect(() => {
    if (pointPKs && pointPKs.length !== 0) {
      console.log(pointPKs)
      fetch(`${server}/pointQuery/${pointPKs.join(',')}`).then(response => {
        if (response.ok) {
          response.json().then(data => {

            setPointsData(data.map(point => {
              return {
                ...point,
                selected: true
              }
            }))
          })
        }
      })
    }
  }, [pointPKs])

  function handleDatasetSelection(point) {
    let dataset = pointsData.filter((p) => p.dataset_id === point.dataset_id)[0]
    dataset.selected = !point.selected
    const result = pointsData.map((p) => {
      if (p.dataset_id === point.dataset_id) {
        return dataset
      } else {
        return p
      }
    })
    setPointsData(result)
  }

  function handleSelectAll() {
    setPointsData(pointsData.map(p => {
      return {
        ...p,
        selected: !selectAll
      }
    }))
    setSelectAll(!selectAll)
  }

  return (
    <div className='pointDetails'>
      <div className='pointDetailsTable'>
        <Table striped hover>
          <thead>
            <tr>
              <th style={{ "width": checkColWidth }} title='Select all' onClick={() => handleSelectAll()}>{selectAll ? <CheckSquare /> : <Square />}</th>
              <th style={{ "width": titleColWidth }} title='Dataset title'>Title</th>
              <th style={{ "width": typeColWidth }} title='Dataset type'>Type</th>
              <th style={{ "width": pointsColWidth }} title='Number of points in dataset'>Points</th>
              <th style={{ "width": sizeColWidth }} title='Approximate dataset size in megabytes'>Size</th>
            </tr>
          </thead>
          <tbody>
            {pointsData.map((point, index) => {
              return (
                <tr key={index} onClick={() => { }} title='Open dataset details'>
                  <td style={{ "width": checkColWidth }} onClick={() => handleDatasetSelection(point)} title='Select dataset for download'>{point.selected ? <CheckSquare /> : <Square />}</td>
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
      <div className='pointDetailsControls'>
        <div className='pointDetailsControlRow'>
          <ProgressBar className='dataTotalBar' now={75} title='Amount of download size used' label={'75/100'} />
          <div className='dataTotalRatio'>75MB/100MB</div>
        </div>
        <div className='pointDetailsControlRow'>
          <input className='emailInput' placeholder='Email Address' />
          <button className='downloadButton'>Download</button>
        </div>
      </div>
    </div >
  )
}