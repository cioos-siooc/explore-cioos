import * as React from 'react'
import { useState, useEffect } from 'react'
import { ProgressBar } from 'react-bootstrap'

import DatasetsTable from '../DatasetsTable/DatasetsTable.jsx'
import DatasetInspector from '../DatasetInspector/DatasetInspector.jsx'
import QuestionIconTooltip from '../QuestionIconTooltip/QuestionIconTooltip.jsx'

import './styles.css'
import { bytesToMemorySizeString, getPointsDataSize } from '../../../utilities.js'

// Note: datasets and points are exchangable terminology
export default function DownloadDetails({ pointsToReview, setPointsToDownload, width, children }) {

  const [selectAll, setSelectAll] = useState(true)
  const [pointsData, setPointsData] = useState(pointsToReview)
  const [inspectDataset, setInspectDataset] = useState()
  const [dataTotal, setDataTotal] = useState(0)

  useEffect(() => {
    if (!_.isEmpty(pointsData)) {
      const total = getPointsDataSize(pointsData)
      setDataTotal(total / 1000000)
      setPointsToDownload(pointsData.filter(point => point.selected))//.map(point => point.pk))
    }
  }, [pointsData])


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

  return (
    <div className='downloadDetails'>
      <div className='downloadDetailsInfoRow'>
        {inspectDataset ?
          <DatasetInspector
            dataset={inspectDataset}
            setInspectDataset={setInspectDataset}
          /> :
          <DatasetsTable
            handleSelectAllDatasets={handleSelectAllDatasets}
            handleSelectDataset={handleSelectDataset}
            setInspectDataset={setInspectDataset}
            selectAll={selectAll}
            setDatasets={setPointsData}
            datasets={pointsData}
            width={width}
          />
        }
      </div>
      <div className='downloadDetailsControls'>
        <div className='downloadDetailsControlRow'>
          <div>
            <ProgressBar
              className='dataTotalBar'
              title='Amount of download size used'
            >
              <ProgressBar
                striped
                className='upTo100'
                variant='success'
                now={dataTotal < 100 ? dataTotal : 100}
                label={dataTotal < 100 ? bytesToMemorySizeString(dataTotal * 1000000) : `100 MB`}
                key={1}
              />
              {dataTotal > 100 &&
                <ProgressBar
                  striped
                  className='past100'
                  variant='warning'
                  now={dataTotal > 100 ? (dataTotal - 100).toFixed(2) : 0}
                  label={dataTotal > 100 ? bytesToMemorySizeString((dataTotal - 100).toFixed(2) * 1000000) : 0}
                  key={2}
                />
              }
            </ProgressBar>
            <div className='dataTotalRatio'>
              {bytesToMemorySizeString(dataTotal * 1000000)} of 100MB Max
              <QuestionIconTooltip
                tooltipText={'Downloads are limited to 100MB.'}
                size={20}
                tooltipPlacement={'top'}
              />
            </div>
          </div>
          {children}
        </div>
      </div>
    </div >
  )
}