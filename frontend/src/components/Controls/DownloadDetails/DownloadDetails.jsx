import * as React from 'react'
import { useState, useEffect } from 'react'
import { Row, Col, Container, Spinner } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'
import _ from 'lodash'

import DatasetsTable from '../DatasetsTable/DatasetsTable.jsx'
import polygonImage from '../../Images/polygonIcon.png'
import rectangleImage from '../../Images/rectangleIcon.png'
import Loading from '../Loading/Loading.jsx'
import {
  getPointsDataSize,
  createDataFilterQueryString,
  bytesToMemorySizeString,
  polygonIsRectangle,
} from '../../../utilities.js'
import { defaultEndDate, defaultEndDepth, defaultStartDate, defaultStartDepth } from '../../config.js'
import { server } from '../../../config.js'
import './styles.css'
import { ArrowsExpand, CalendarWeek, Check2Circle, XCircle } from 'react-bootstrap-icons'


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
    setDownloadSizeEstimates()
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
      let tempDataTotal = 0
      const tempData = pointsData.map((ds) => {
        const tempDS = downloadSizeEstimates.filter(dse => dse.pk === ds.pk)[0]
        const estimates = {
          filteredSize: tempDS.size,
          unfilteredSize: tempDS.unfilteredSize
        }
        tempDataTotal = tempDataTotal + tempDS.size
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
      setDataTotal(tempDataTotal)
    }
  }, [downloadSizeEstimates])

  useEffect(() => {
    if (!_.isEmpty(pointsData)) {
      setPointsToDownload(pointsData.filter((point) => point.selected && !point.downloadDisabled))
      if (downloadSizeEstimates) {
        let tempDataTotal = 0
        pointsData.forEach(point => {
          if (point.selected) {
            tempDataTotal = tempDataTotal + point.sizeEstimate.filteredSize
          }
        })
        setDataTotal(tempDataTotal)
      }
    }
  }, [pointsData])

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
          <strong>Download limits</strong>
          <div>
            {'Datasets '}
            <strong style={{ color: 'white', backgroundColor: '#4fbc89' }}>{'smaller than 1GB'}</strong>
            {' are CDE downloadable '} <Check2Circle color='green' size='25' /> {'through the CIOOS Data Explorer.'}
          </div>
          <div>
            {'Datasets '}
            <strong style={{ color: 'white', backgroundColor: '#dc3545' }}>{'larger than 1GB'}</strong>
            {' are not CDE downloadable '}<XCircle color='red' size='25' /> {', but can be downloaded individually through ERDDAP.'}
          </div>
          <div>
            <i>Tip:</i>{' Use Time, Depth and Space filters to change dataset download sizes. Toggle active filters on and off below.'}
          </div>
        </Col>
      </Row>
      <Row>
        <Col>
          <div
            className='filterDownloadToggles'
          >
            {timeFilterActive &&
              <div
                className={timeFilterToggleClassName}
              >
                {/* <strong>
                  {'Time: '}
                </strong> */}
                <>
                  <button
                    onClick={() => setFilterDownloadByTime(!filterDownloadByTime)}
                    disabled={!timeFilterActive}
                  >
                    <CalendarWeek style={{
                      margin: '0px 15px',
                      height: '30px'
                    }} />
                    {`${query.startDate} - ${query.endDate}`}
                  </button>
                  {/* {filterDownloadByTime ?
                    <CheckSquare />
                    :
                    <Square />
                  } */}
                </>
              </div>
            }
            {depthFilterActive &&
              <div
                className={depthFilterToggleClassName}
              >
                {/* <strong>
                  {'Depth: '}
                </strong> */}
                <>
                  <button
                    onClick={() => setFilterDownloadByDepth(!filterDownloadByDepth)}
                    disabled={!depthFilterActive}
                  >
                    <ArrowsExpand style={{
                      margin: '0px 15px',
                      height: '30px'
                    }} />
                    {`${query.startDepth} - ${query.endDepth}(m)`}
                  </button>
                  {/* {filterDownloadByDepth ?
                    <CheckSquare />
                    :
                    <Square />
                  } */}
                </>
              </div>
            }
            {polygonFilterActive &&
              <div
                className={polygonFilterToggleClassName}
              >
                {/* <strong>
                  {'Shape: '}
                </strong> */}
                <>
                  <button
                    onClick={() => setFilterDownloadByPolygon(!filterDownloadByPolygon)}
                    disabled={!polygonFilterActive}
                  >
                    <div
                      className='mapbox-gl-draw-polygon'
                      style={{
                        display: 'inline',
                        backgroundImage: `url(${polygonIsRectangle(polygon) ? rectangleImage : polygonImage})`,
                        backgroundRepeat: 'no-repeat',
                        backgroundSize: '30px 30px',
                        backgroundPositionX: '10px',
                        backgroundPositionY: '-5px',
                        borderRadius: '0px',
                        height: '42px',
                        paddingLeft: '45px'
                      }}
                    >
                      {`${polygon.map((coordinate, index) => {
                        if (index !== polygon.length - 1) {
                          return `[${coordinate[0].toFixed(2)}, ${coordinate[1].toFixed(2)}]`
                        }
                      })}`}
                    </div>
                  </button>
                  {/* {filterDownloadByPolygon ?
                    <CheckSquare />
                    :
                    <Square />
                  } */}
                </>
              </div>
            }
          </div>
        </Col>
      </Row>
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
            loading={loading}
          />
        </Col>
      </Row>
      <hr />
      <Row className='downloadDetailsDownloadInfoRow'>
        <Col>
          <div className='downloadDetailsDownloadInfoItem'>
            {'Download '}
            {
              downloadSizeEstimates ?
                <strong>
                  {`${pointsData.filter(point => point.selected).length} / ${pointsData.length}`}
                </strong>
                :
                <Spinner
                  className='datasetSizeTotalSpinner'
                  as='span'
                  animation='border'
                  size={30}
                  role='status'
                  aria-hidden='true'
                />
            }
          </div>
          <div className='downloadDetailsDownloadInfoItem'>
            {'Downloadable size '}
            {downloadSizeEstimates ?
              <strong>
                {bytesToMemorySizeString(dataTotal)}
              </strong>
              :
              <Spinner
                className='datasetSizeTotalSpinner'
                as='span'
                animation='border'
                size={30}
                role='status'
                aria-hidden='true'
              />
            }
          </div>
        </Col>
        {children}
      </Row>
    </Container>
  )
}
