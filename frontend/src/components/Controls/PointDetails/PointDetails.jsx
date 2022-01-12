import * as React from 'react'
import { useState, useEffect } from 'react'
import { Container, Table, Row, Col, ProgressBar } from 'react-bootstrap'
import { CheckSquare, Square } from 'react-bootstrap-icons'

import { server } from '../../../config'

import './styles.css'

export default function PointDetails({ pointPKs, setPointsToDownload }) {
  const [pointsData, setPointsData] = useState([])
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
            setPointsData(data)
          })
        }
      })
    }
  }, [pointPKs])

  return (
    <div className='pointDetails'>
      <div className='pointDetailsTable'>
        <Table striped hover>
          <thead>
            <tr>
              <th style={{ "width": checkColWidth }} title='Select all'><CheckSquare /></th>
              <th style={{ "width": titleColWidth }}>Title</th>
              <th style={{ "width": typeColWidth }}>Type</th>
              <th style={{ "width": pointsColWidth }}>Points</th>
              <th style={{ "width": sizeColWidth }}>Size</th>
            </tr>
          </thead>
          <tbody>
            {pointsData.map((point, index) => {
              { console.log(pointsData) }
              return (
                <tr key={index}>
                  <td style={{ "width": checkColWidth }}><CheckSquare /></td>
                  <td style={{ "width": titleColWidth }}>{point.title}</td>
                  <td style={{ "width": typeColWidth }}>A/B/C/D</td>
                  <td style={{ "width": pointsColWidth }}>{point.profiles.length}</td>
                  <td style={{ "width": sizeColWidth }}>{Math.floor(point.profiles.length * 0.1)} MB</td>
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