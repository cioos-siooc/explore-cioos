import * as React from 'react'
import { useState, useEffect } from 'react'
import { Row, Col, Container } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'
import _ from 'lodash'

import DatasetsTable from '../DatasetsTable/DatasetsTable.jsx'
import Loading from '../Loading/Loading.jsx'
import {
  getPointsDataSize,
  createDataFilterQueryString,
} from '../../../utilities.js'
import { defaultEndDate, defaultEndDepth, defaultStartDate, defaultStartDepth } from '../../config.js'
import { server } from '../../../config.js'
import './styles.css'


// Note: datasets and points are exchangable terminology
export default function DownloadDetails({
  pointsToReview,
  setPointsToDownload,
  setHoveredDataset,
  polygon,
  query,
  timeFilterActive,
  filterDownloadByTime,
  setFilterDownloadByTime,
  depthFilterActive,
  filterDownloadByDepth,
  setFilterDownloadByDepth,
  polygonFilterActive,
  filterDownloadByPolygon,
  setFilterDownloadByPolygon,
  children
}) {
  const { t } = useTranslation()
  const [selectAll, setSelectAll] = useState(true)
  const [pointsData, setPointsData] = useState(pointsToReview.map(ptr => {
    return { ...ptr, downloadDisabled: false }
  }))
  const [dataTotal, setDataTotal] = useState(0)
  const [downloadSizeEstimates, setDownloadSizeEstimates] = useState()
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    let url = `${server}/downloadEstimate?`
    let unfilteredSizeEstimates
    let filteredAndUnfilteredSizeEstimates
    if (pointsData) {
      url += `&datasetPKs=${pointsData.map(ds => ds.pk).join(',')}`
    }
    fetch(url).then(response => response.ok && response.json()).then(ufse => {
      unfilteredSizeEstimates = ufse
    }).then(() => {
      if (filterDownloadByPolygon || filterDownloadByTime || filterDownloadByDepth) {
        if (polygon && filterDownloadByPolygon) {
          url += `&polygon=${JSON.stringify(polygon)}`
        }
        if (query) {
          const tempQuery = { ...query }
          if (!filterDownloadByTime) {
            tempQuery.startDate = defaultStartDate
            tempQuery.endDate = defaultEndDate
          }
          if (!filterDownloadByDepth) {
            tempQuery.startDepth = defaultStartDepth
            tempQuery.endDepth = defaultEndDepth
          }
          url += `&${createDataFilterQueryString(tempQuery)}`
        }
        fetch(url).then((response) => {
          if (response.ok) return response.json()
        }).then((estimates) => {
          filteredAndUnfilteredSizeEstimates = estimates.map(e => {
            return {
              ...e,
              unfilteredSize: unfilteredSizeEstimates.filter(ufse => ufse.pk === e.pk)[0].size
            }
          })
          setDownloadSizeEstimates(filteredAndUnfilteredSizeEstimates)
        }).catch((error) => { throw error }).then(() => setLoading(false))
      } else {
        filteredAndUnfilteredSizeEstimates = unfilteredSizeEstimates.map(e => {
          return {
            ...e,
            unfilteredSize: unfilteredSizeEstimates.filter(ufse => ufse.pk === e.pk)[0].size
          }
        })
        setDownloadSizeEstimates(filteredAndUnfilteredSizeEstimates)
      }
    }).catch(error => { throw error }).then(() => setLoading(false))
  }, [query, polygon, filterDownloadByTime, filterDownloadByDepth, filterDownloadByPolygon])

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

  const filterToggleClassname = 'filterDownloadToggle'
  const timeFilterToggleClassName = classNames(filterToggleClassname, { active: filterDownloadByTime }, { disabled: !timeFilterActive })
  const depthFilterToggleClassName = classNames(filterToggleClassname, { active: filterDownloadByDepth }, { disabled: !depthFilterActive })
  const polygonFilterToggleClassName = classNames(filterToggleClassname, { active: filterDownloadByPolygon }, { disabled: !polygonFilterActive })
  return (
    <Container className='downloadDetails'>
      <Row>
        <Col>
          <div
            className='filterDownloadToggles'
          >
            <strong>Filter downloaded data by:</strong>
            <button
              className={timeFilterToggleClassName}
              onClick={() => setFilterDownloadByTime(!filterDownloadByTime)}
              disabled={!timeFilterActive}
            >
              Time
            </button>
            <button
              className={depthFilterToggleClassName}
              onClick={() => setFilterDownloadByDepth(!filterDownloadByDepth)}
              disabled={!depthFilterActive}
            >
              Depth
            </button>
            <button
              className={polygonFilterToggleClassName}
              onClick={() => setFilterDownloadByPolygon(!filterDownloadByPolygon)}
              disabled={!polygonFilterActive}
            >
              Polygon
            </button>
          </div>
        </Col>
      </Row>
      <Row className='downloadDataRow'>
        <Col>
          {/* {loading ?
            <Loading />
            :
          } */}
          <DatasetsTable
            isDownloadModal
            handleSelectAllDatasets={handleSelectAllDatasets}
            handleSelectDataset={handleSelectDataset}
            selectAll={selectAll}
            setDatasets={setPointsData}
            datasets={pointsData}
            setHoveredDataset={setHoveredDataset}
            downloadSizeEstimates={downloadSizeEstimates}
            loading={loading}
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
