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
import { ArrowsExpand, CalendarWeek, Check2Circle, ChevronCompactLeft, XCircle } from 'react-bootstrap-icons'
import QuestionIconTooltip from '../QuestionIconTooltip/QuestionIconTooltip.jsx'


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
  setSubmissionState,
  setShowModal,
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
    setSubmissionState()
  }, [query, polygon, filterDownloadByTime, filterDownloadByDepth, filterDownloadByPolygon])

  useEffect(() => {
    if (downloadSizeEstimates) {
      let tempDataTotal = 0
      let tempDataDownloadable = 0
      const tempData = pointsData.map((ds) => {
        const tempDS = downloadSizeEstimates.filter(dse => dse.pk === ds.pk)[0]
        const estimates = {
          filteredSize: tempDS.size,
          unfilteredSize: tempDS.unfilteredSize
        }
        tempDataTotal = tempDataTotal + tempDS.unfilteredSize
        tempDataDownloadable = tempDataDownloadable + tempDS.size
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
      setDataTotal({ unfilteredSize: tempDataTotal, filteredSize: tempDataDownloadable })
    }
  }, [downloadSizeEstimates])

  useEffect(() => {
    if (!_.isEmpty(pointsData)) {
      setPointsToDownload(pointsData.filter((point) => point.selected && !point.downloadDisabled))
      if (downloadSizeEstimates) {
        let tempDataTotal = 0
        let tempDataDownloadable = 0
        pointsData.forEach(point => {
          tempDataTotal = tempDataTotal + point.sizeEstimate.unfilteredSize
          if (point.selected) {
            tempDataDownloadable = tempDataDownloadable + point.sizeEstimate.filteredSize
          }
        })
        setDataTotal({ unfilteredSize: tempDataTotal, filteredSize: tempDataDownloadable })
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
  let polygonFilterText = ''

  if (polygon) {
    polygon.forEach((coordinate, index) => {
      if (polygon.length >= 6) {
        if (index === polygon.length - 2) {
          polygonFilterText += `...[${coordinate[0].toFixed(1)}, ${coordinate[1].toFixed(1)}]`
        } else if (index <= 3) {
          polygonFilterText += `[${coordinate[0].toFixed(1)}, ${coordinate[1].toFixed(1)}]`
        }
      } else if (index < polygon.length - 1) {
        polygonFilterText += `[${coordinate[0].toFixed(1)}, ${coordinate[1].toFixed(1)}]`
      }
    })
  }
  return (
    <Container className='downloadDetails'>
      <button className='downloadDetailsBackButton' onClick={() => setShowModal(false)}>
        <ChevronCompactLeft />{t('downloadModalBackButtonText')}
      </button>
      <Row style={{ padding: '0px' }}>
        <Col>
          <div
            className='filterDownloadToggles'
          >
            {(!timeFilterActive && !depthFilterActive && !polygonFilterActive) && (
              <>
                < QuestionIconTooltip
                  tooltipText={t('downloadDetailsFilterQuestionTooltipText')}
                  tooltipPlacement={'left'}
                  size={20}
                />
                <i>
                  {t('downloadDetailsNoFiltersActiveMessage')}
                </i>
              </>
            )}
            {(timeFilterActive || depthFilterActive || polygonFilterActive) &&
              <QuestionIconTooltip
                tooltipText={t('downloadDetailsFilterQuestionTooltipText')}
                tooltipPlacement={'left'}
                size={20}
                className='helpIconWithMarginTop'
              />
            }
            {timeFilterActive &&
              <div
                className={timeFilterToggleClassName}
              >
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
                </>
              </div>
            }
            {depthFilterActive &&
              <div
                className={depthFilterToggleClassName}
              >
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
                </>
              </div>
            }
            {polygonFilterActive &&
              <div
                className={polygonFilterToggleClassName}
              >
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
                      {polygonFilterText}
                    </div>
                  </button>
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
      <Row className='downloadDetailsDownloadLimits'>
        <Col style={{ textAlign: 'center', margin: '15px 0px' }}>
          <div>
            {t('downloadDetailsDownloadLimitsNotDownloadableMessagePart1')}
            <strong style={{ color: 'white', backgroundColor: '#e3285e' }}>{t('downloadDetailsDownloadLimitsNotDownloadableMessagePart2')}</strong>
            {t('downloadDetailsDownloadLimitsNotDownloadableMessagePart3')}<XCircle color='#e3285e' size='25' />
            {t('downloadDetailsDownloadLimitsDownloadableMessagePart1')}
            <strong style={{ color: 'white', backgroundColor: '#52a79b' }}>{t('downloadDetailsDownloadLimitsDownloadableMessagePart2')}</strong>
            {t('downloadDetailsDownloadLimitsDownloadableMessagePart3')} <Check2Circle color='#52a79b' size='25' />
          </div>
        </Col>
      </Row>
      <Row className='downloadDetailsDownloadInfoRow'>
        <Col>
          <div className='downloadDetailsDownloadInfoItem'>
            {t('downloadDetailsDownloadInfoDatasets')}
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
            {t('downloadDetailsDownloadInfoDownloadSize')}
            {downloadSizeEstimates ?
              <strong>
                {`${bytesToMemorySizeString(dataTotal.filteredSize)} /
                ${bytesToMemorySizeString(dataTotal.unfilteredSize)}`}
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
