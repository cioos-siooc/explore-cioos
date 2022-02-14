import * as React from 'react'
import { useState, useEffect } from 'react'
import { ProgressBar, Row, Col } from 'react-bootstrap'

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
    let dataset = pointsData.filter((p) => p.pk === point.pk)[0]
    dataset.selected = !point.selected
    const result = pointsData.map((p) => {
      if (p.pk === point.pk) {
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
      <Row>
        <Col>
          <div className='downloadDetailsInfoRow'>
            {inspectDataset ?
              <DatasetInspector
                dataset={inspectDataset}
                setInspectDataset={setInspectDataset}
                width={width}
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
        </Col>
        <Col className='downloadHelp'>
          <div className='downloadQuote'>
            <i >
              "Use the CIOOS Data Explorer to get exactly the data you want."
            </i>
          </div>
          <hr />
          <div>
            <b>Download Data:</b>
            <ul>
              <li>
                Finalize dataset selections,
              </li>
              <li>
                Ensure selections satisfy the 100MB limit,
              </li>
              <li>
                Provide an email address to receive the download link, and,
              </li>
              <li>
                Submit the download request.
              </li>
            </ul>
          </div>
          <i>Note:</i> Filters applied in the CIOOS Data Explorer also apply to dataset downloads.
        </Col>
      </Row>
      <Row>

        <div className='downloadDetailsControls'>
          <Row className='downloadDetailsControlRow'>
            <Col>
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
            </Col>
            {children}
          </Row>
        </div>
      </Row>
    </div >
  )
}