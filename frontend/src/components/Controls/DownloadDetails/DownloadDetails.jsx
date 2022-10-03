import * as React from 'react'
import { useState, useEffect } from 'react'
import { ProgressBar, Row, Col, Container } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'

import DatasetsTable from '../DatasetsTable/DatasetsTable.jsx'

import './styles.css'
import {
  bytesToMemorySizeString,
  getPointsDataSize,
  createDataFilterQueryString
} from '../../../utilities.js'
import { server } from '../../../config.js'

// Note: datasets and points are exchangable terminology
export default function DownloadDetails({
  pointsToReview,
  setPointsToDownload,
  setHoveredDataset,
  polygon,
  query,
  children
}) {
  const { t } = useTranslation()

  const [selectAll, setSelectAll] = useState(true)
  const [pointsData, setPointsData] = useState(pointsToReview.map(ptr => {
    return { ...ptr, downloadDisabled: false }
  }))
  const [dataTotal, setDataTotal] = useState(0)
  const [downloadSizeEstimates, setDownloadSizeEstimates] = useState()

  useEffect(() => {
    let url = `${server}/downloadEstimate?`
    let unfilteredSizeEstimates
    if (pointsData) {
      url += `&datasetPKs=${pointsData.map(ds => ds.pk).join(',')}`
    }
    fetch(url).then(response => response.ok && response.json()).then(ufse => {
      unfilteredSizeEstimates = ufse
    }).then(() => {
      if (polygon) {
        url += `&polygon=${JSON.stringify(polygon)}`
      }
      if (query) {
        url += `&${createDataFilterQueryString(query)}`
      }
      fetch(url).then((response) => {
        if (response.ok) return response.json()
      }).then((estimates) => {
        const filteredAndUnfilteredSizeEstimates = estimates.map(e => {
          return {
            ...e,
            unfilteredSize: unfilteredSizeEstimates.filter(ufse => ufse.pk === e.pk)[0].size
          }
        })
        setDownloadSizeEstimates(filteredAndUnfilteredSizeEstimates)
      }).catch((error) => {
        throw error
      })
    }).catch(error => {
      throw error
    })
  }, [query, polygon])

  useEffect(() => {
    if (downloadSizeEstimates) {
      const tempData = pointsData.map((ds) => {
        const tempDS = downloadSizeEstimates.filter(dse => dse.pk === ds.pk)[0]
        const estimates = {
          filteredSize: tempDS.size,
          unfilteredSize: tempDS.unfilteredSize
        }
        return {
          ...ds,
          selected: estimates.filteredSize < 1000000000,
          sizeEstimate: estimates,
          internalDownload: estimates.filteredSize < 1000000000,
          erddapLink: ds.erddap_url,
          downloadDisabled: estimates.filteredSize > 1000000000
        }
      })
      setPointsData(tempData)
    }
  }, [downloadSizeEstimates])

  useEffect(() => {
    if (!_.isEmpty(pointsData)) {
      const total = getPointsDataSize(pointsData)
      setDataTotal(total / 1000000)
      setPointsToDownload(pointsData.filter((point) => point.selected && !point.downloadDisabled))
    }
  }, [pointsData, downloadSizeEstimates])

  function handleSelectDataset(point) {
    const dataset = pointsData.filter((p) => p.pk === point.pk)[0]
    if (!point.downloadDisabled) {
      dataset.selected = !point.selected
    }
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
          selected: p.downloadDisabled === false ? !selectAll : false
        }
      })
    )
    setSelectAll(!selectAll)
  }

  return (
    <Container className='downloadDetails'>
      <Row className='downloadDataRow'>
        <Col>
          <DatasetsTable
            isDownloadModal
            handleSelectAllDatasets={handleSelectAllDatasets}
            handleSelectDataset={handleSelectDataset}
            selectAll={selectAll}
            setDatasets={setPointsData}
            datasets={pointsData}
            setHoveredDataset={setHoveredDataset}
            downloadSizeEstimates={downloadSizeEstimates}
          />
        </Col>
      </Row>
      <hr />
      <Row>
        <Col>
          Test
        </Col>
        {children}
      </Row>
    </Container>
  )
}
