import * as React from 'react'
import { useState, useEffect } from 'react'
import { ProgressBar, Row, Col, Container } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'

import DatasetsTable from '../DatasetsTable/DatasetsTable.jsx'
import DatasetInspector from '../DatasetInspector/DatasetInspector.jsx'
import QuestionIconTooltip from '../QuestionIconTooltip/QuestionIconTooltip.jsx'

import './styles.css'
import {
  bytesToMemorySizeString,
  getPointsDataSize
} from '../../../utilities.js'

// Note: datasets and points are exchangable terminology
export default function DownloadDetails({
  pointsToReview,
  setPointsToDownload,
  setHoveredDataset,
  children
}) {
  const { t } = useTranslation()

  const [selectAll, setSelectAll] = useState(true)
  const [pointsData, setPointsData] = useState(pointsToReview)
  const [inspectDataset, setInspectDataset] = useState()
  const [dataTotal, setDataTotal] = useState(0)

  useEffect(() => {
    if (!_.isEmpty(pointsData)) {
      const total = getPointsDataSize(pointsData)
      setDataTotal(total / 1000000)
      setPointsToDownload(pointsData.filter((point) => point.selected))
    }
  }, [pointsData])

  function handleSelectDataset(point) {
    const dataset = pointsData.filter((p) => p.pk === point.pk)[0]
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
    setPointsData(
      pointsData.map((p) => {
        return {
          ...p,
          selected: !selectAll
        }
      })
    )
    setSelectAll(!selectAll)
  }

  return (
    <Container className='downloadDetails'>
      <Row>
        <Col>
          <span>
            <b>{t('downloadDetailsDownloadDataBoldText')}</b>
            {/* Download Data */}
            {/* {t('downloadDetailsDownloadDataStepsText')} */}
            {/* 1) Finalize dataset selections,
            2) Ensure selections are within the 100MB limit,
            3) Provide an email address to receive the download link, and,
            4) Submit the download request.
            Filters applied in the CIOOS Data Explorer also apply to dataset downloads. */}
            <ol>
              <li>{t('downloadDetailsDownloadDataSteps1')}</li>
              <li>{t('downloadDetailsDownloadDataSteps2')}</li>
              <li>{t('downloadDetailsDownloadDataSteps3')}</li>
              <li>{t('downloadDetailsDownloadDataSteps4')}</li>
            </ol>
          </span>
        </Col>
      </Row>
      <hr />
      <Row className='downloadDataRow'>
        <Col>
          {inspectDataset ? (
            <DatasetInspector
              dataset={inspectDataset}
              setInspectDataset={setInspectDataset}
            />
          ) : (
            <DatasetsTable
              handleSelectAllDatasets={handleSelectAllDatasets}
              handleSelectDataset={handleSelectDataset}
              setInspectDataset={setInspectDataset}
              selectAll={selectAll}
              setDatasets={setPointsData}
              datasets={pointsData}
              setHoveredDataset={setHoveredDataset}
            />
          )}
        </Col>
      </Row>
      <hr />
      <Row>
        <Col>
          <ProgressBar
            className='dataTotalBar'
            title={t('downloadDetailsProgressTitle')} // 'Amount of download size used'
          >
            <ProgressBar
              striped
              className='upTo100'
              variant='success'
              now={dataTotal < 100 ? dataTotal : 100}
              label={
                dataTotal < 100
                  ? bytesToMemorySizeString(dataTotal * 1000000)
                  : '100 MB'
              }
              key={1}
            />
            {dataTotal > 100 && (
              <ProgressBar
                striped
                className='past100'
                variant='warning'
                now={dataTotal > 100 ? (dataTotal - 100).toFixed(2) : 0}
                label={
                  dataTotal > 100
                    ? bytesToMemorySizeString(
                      (dataTotal - 100).toFixed(2) * 1000000
                    )
                    : 0
                }
                key={2}
              />
            )}
          </ProgressBar>
          <div className='dataTotalRatio'>
            {bytesToMemorySizeString(dataTotal * 1000000)} of 100MB Max
            <QuestionIconTooltip
              tooltipText={'downloadDetailsProgressTooltipText'} // 'Downloads are limited to 100MB.'
              size={20}
              tooltipPlacement={'top'}
            />
          </div>
        </Col>
        {children}
      </Row>
    </Container>
  )
}
