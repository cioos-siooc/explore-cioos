import * as React from 'react'
import { useState, useEffect } from 'react'
import { ProgressBar } from 'react-bootstrap'

import DatasetsTable from '../DatasetsTable/DatasetsTable.jsx'
import DatasetInspector from '../DatasetInspector/DatasetInspector.jsx'
import { server } from '../../../config'

import './styles.css'

// Note: datasets and points are exchangable terminology
export default function SelectionDetails({ pointPKs, setPointsToDownload }) {
  const [selectAll, setSelectAll] = useState(true)
  const [pointsData, setPointsData] = useState([])
  const [inspectDataset, setInspectDataset] = useState()
  const [dataTotal, setDataTotal] = useState(0)

  useEffect(() => {
    let total = 0
    pointsData.forEach((point) => {
      if (point.selected) {
        total += Math.floor(point.profiles.length)
      }
    })
    setDataTotal(total)
  }, [pointsData])

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

  function handleSelectDataset(point) {
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

  function handleSelectAllDatasets() {
    setPointsData(pointsData.map(p => {
      return {
        ...p,
        selected: !selectAll
      }
    }))
    setSelectAll(!selectAll)
  }

  // console.log(pointsData)
  return (
    <div className='pointDetails'>
      <div className='pointDetailsInfoRow'>
        {
          inspectDataset ?
            <DatasetInspector
              dataset={inspectDataset}
              setInspectDataset={setInspectDataset}
            /> :
            <DatasetsTable
              handleSelectAllDatasets={handleSelectAllDatasets}
              handleSelectDataset={handleSelectDataset}
              setInspectDataset={setInspectDataset}
              selectAll={selectAll}
              datasets={pointsData}
            />
        }
      </div>
      <div className='pointDetailsControls'>
        <div className='pointDetailsControlRow'>
          <ProgressBar
            className='dataTotalBar'
            title='Amount of download size used'
          >
            <ProgressBar
              className='upTo100'
              variant='success'
              now={dataTotal < 100 ? dataTotal : 100}
              label={dataTotal < 100 ? dataTotal : 100}
              key={1}
            />
            {dataTotal > 100 &&
              <ProgressBar
                className='past100'
                variant='warning'
                now={dataTotal > 100 ? dataTotal - 100 : 0}
                label={dataTotal > 100 ? dataTotal - 100 : 0}
                key={2}
              />
            }
          </ProgressBar>
          <div className='dataTotalRatio'>{dataTotal} / 100MB</div>
        </div>
        <div className='pointDetailsControlRow'>
          <input className='emailInput' placeholder='Email Address' />
          <button className='downloadButton'>Download</button>
        </div>
      </div>
    </div >
  )
}