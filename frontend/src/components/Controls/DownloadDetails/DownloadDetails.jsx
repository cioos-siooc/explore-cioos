import * as React from 'react'
import { useState, useEffect } from 'react'
import { Row, Col, Container, Spinner } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'
import bytes from 'bytes'

import DatasetsTable from '../DatasetsTable/DatasetsTable.jsx'
import polygonImage from '../../Images/polygonIcon.png'
import rectangleImage from '../../Images/rectangleIcon.png'
import isEmpty from 'lodash/isEmpty'

import {
  createDataFilterQueryString,
  polygonIsRectangle
} from '../../../utilities.js'
import {
  defaultEndDate,
  defaultEndDepth,
  defaultStartDate,
  defaultStartDepth
} from '../../config.js'
import { server } from '../../../config.js'
import './styles.css'
import {
  ArrowsExpand,
  CalendarWeek,
  Check2Circle,
  ChevronCompactLeft,
  Download,
  XCircle
} from 'react-bootstrap-icons'
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
  const [pointsData, setPointsData] = useState(
    pointsToReview.map((ptr) => {
      return { ...ptr, downloadDisabled: false }
    })
  )
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
      url += `&datasetPKs=${pointsData.map((ds) => ds.pk).join(',')}`
    }
    fetch(url)
      .then((response) => response.ok && response.json())
      .then((ufse) => {
        unfilteredSizeEstimates = ufse
      })
      .then(() => {
        if (
          filterDownloadByPolygon ||
          filterDownloadByTime ||
          filterDownloadByDepth
        ) {
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
          fetch(url)
            .then((response) => {
              if (response.ok) return response.json()
            })
            .then((estimates) => {
              filteredAndUnfilteredSizeEstimates = estimates.map((e) => {
                return {
                  ...e,
                  unfilteredSize: unfilteredSizeEstimates.filter(
                    (ufse) => ufse.pk === e.pk
                  )[0].size
                }
              })
              setDownloadSizeEstimates(filteredAndUnfilteredSizeEstimates)
            })
            .catch((error) => {
              throw error
            })
            .then(() => setLoading(false))
        } else {
          filteredAndUnfilteredSizeEstimates = unfilteredSizeEstimates.map(
            (e) => {
              return {
                ...e,
                unfilteredSize: unfilteredSizeEstimates.filter(
                  (ufse) => ufse.pk === e.pk
                )[0].size
              }
            }
          )
          setDownloadSizeEstimates(filteredAndUnfilteredSizeEstimates)
        }
      })
      .catch((error) => {
        throw error
      })
      .then(() => setLoading(false))
    setSubmissionState()
  }, [
    query,
    polygon,
    filterDownloadByTime,
    filterDownloadByDepth,
    filterDownloadByPolygon
  ])

  useEffect(() => {
    if (downloadSizeEstimates) {
      let tempDataTotal = 0
      let tempDataDownloadable = 0
      const tempData = pointsData.map((ds) => {
        const tempDS = downloadSizeEstimates.filter(
          (dse) => dse.pk === ds.pk
        )[0]
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
      setDataTotal({
        unfilteredSize: tempDataTotal,
        filteredSize: tempDataDownloadable
      })
    }
  }, [downloadSizeEstimates])

  useEffect(() => {
    if (!isEmpty(pointsData)) {
      setPointsToDownload(
        pointsData.filter((point) => point.selected && !point.downloadDisabled)
      )
      if (downloadSizeEstimates) {
        let tempDataTotal = 0
        let tempDataDownloadable = 0
        pointsData.forEach((point) => {
          tempDataTotal = tempDataTotal + point.sizeEstimate.unfilteredSize
          if (point.selected) {
            tempDataDownloadable =
              tempDataDownloadable + point.sizeEstimate.filteredSize
          }
        })
        setDataTotal({
          unfilteredSize: tempDataTotal,
          filteredSize: tempDataDownloadable
        })
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
  const timeFilterToggleClassName = classNames(
    filterToggleClassname,
    { active: filterDownloadByTime },
    { disabled: !timeFilterActive }
  )
  const depthFilterToggleClassName = classNames(
    filterToggleClassname,
    { active: filterDownloadByDepth },
    { disabled: !depthFilterActive }
  )
  const polygonFilterToggleClassName = classNames(
    filterToggleClassname,
    { active: filterDownloadByPolygon },
    { disabled: !polygonFilterActive }
  )
  let polygonFilterText = ''

  if (polygon) {
    polygon.forEach((coordinate, index) => {
      if (polygon.length >= 6) {
        if (index === polygon.length - 2) {
          polygonFilterText += `...[${coordinate[0].toFixed(
            1
          )}, ${coordinate[1].toFixed(1)}]`
        } else if (index <= 3) {
          polygonFilterText += `[${coordinate[0].toFixed(
            1
          )}, ${coordinate[1].toFixed(1)}]`
        }
      } else if (index < polygon.length - 1) {
        polygonFilterText += `[${coordinate[0].toFixed(
          1
        )}, ${coordinate[1].toFixed(1)}]`
      }
    })
  }
  const selectedCount = pointsData.filter((point) => point.selected).length

  return (
    <Container className='downloadDetails'>
      <div className='downloadDetailsHeader'>
        <button
          className='downloadDetailsBackButton'
          onClick={() => setShowModal(false)}
        >
          <ChevronCompactLeft aria-hidden='true' />
          {t('downloadModalBackButtonText')}
        </button>
        <h2 className='downloadDetailsTitle'>
          <Download size={18} aria-hidden='true' />
          {t('downloadModalTitleText')}
        </h2>
      </div>

      <div className='filterDownloadToggles'>
        <QuestionIconTooltip
          tooltipText={t('downloadDetailsFilterQuestionTooltipText')}
          tooltipPlacement={'right'}
          size={20}
        />
        {!timeFilterActive && !depthFilterActive && !polygonFilterActive && (
          <i className='noFiltersMessage'>
            {t('downloadDetailsNoFiltersActiveMessage')}
          </i>
        )}
        {timeFilterActive && (
          <div className={timeFilterToggleClassName}>
            <button
              onClick={() => setFilterDownloadByTime(!filterDownloadByTime)}
              disabled={!timeFilterActive}
            >
              <CalendarWeek className='filterToggleIcon' size={16} aria-hidden='true' />
              <span>{`${query.startDate} – ${query.endDate}`}</span>
            </button>
          </div>
        )}
        {depthFilterActive && (
          <div className={depthFilterToggleClassName}>
            <button
              onClick={() => setFilterDownloadByDepth(!filterDownloadByDepth)}
              disabled={!depthFilterActive}
            >
              <ArrowsExpand className='filterToggleIcon' size={16} aria-hidden='true' />
              <span>{`${query.startDepth} – ${query.endDepth} m`}</span>
            </button>
          </div>
        )}
        {polygonFilterActive && (
          <div className={polygonFilterToggleClassName}>
            <button
              onClick={() => setFilterDownloadByPolygon(!filterDownloadByPolygon)}
              disabled={!polygonFilterActive}
            >
              <div
                className='mapbox-gl-draw-polygon filterToggleIcon'
                style={{
                  display: 'inline',
                  backgroundImage: `url(${polygonIsRectangle(polygon)
                    ? rectangleImage
                    : polygonImage
                  })`,
                  backgroundRepeat: 'no-repeat',
                  backgroundSize: '24px 24px',
                  backgroundPositionX: '8px',
                  backgroundPositionY: '-3px',
                  borderRadius: '0px',
                  height: '34px',
                  paddingLeft: '38px'
                }}
              >
                {polygonFilterText}
              </div>
            </button>
          </div>
        )}
      </div>

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

      <div className='downloadLegend'>
        <span className='downloadLegendItem'>
          <Check2Circle className='legendIcon success' size={18} aria-hidden='true' />
          <span>
            {t('downloadDetailsDownloadLimitsDownloadableMessagePart1')}
            <span className='legendBadge success'>
              {t('downloadDetailsDownloadLimitsDownloadableMessagePart2')}
            </span>
            {t('downloadDetailsDownloadLimitsDownloadableMessagePart3')}
          </span>
        </span>
        <span className='downloadLegendItem'>
          <XCircle className='legendIcon error' size={18} aria-hidden='true' />
          <span>
            {t('downloadDetailsDownloadLimitsNotDownloadableMessagePart1')}
            <span className='legendBadge error'>
              {t('downloadDetailsDownloadLimitsNotDownloadableMessagePart2')}
            </span>
            {t('downloadDetailsDownloadLimitsNotDownloadableMessagePart3')}
          </span>
        </span>
      </div>

      <Row className='downloadDetailsDownloadInfoRow'>
        <Col xs='auto'>
          <div className='downloadSummary'>
            <div className='downloadSummaryStat'>
              <span className='downloadSummaryLabel'>
                {t('downloadDetailsDownloadInfoDatasets')}
              </span>
              {downloadSizeEstimates ? (
                <span className='downloadSummaryValue'>
                  {`${selectedCount} / ${pointsData.length}`}
                </span>
              ) : (
                <Spinner
                  className='datasetSizeTotalSpinner'
                  as='span'
                  animation='border'
                  role='status'
                  aria-hidden='true'
                />
              )}
            </div>
            <div className='downloadSummaryStat'>
              <span className='downloadSummaryLabel'>
                {t('downloadDetailsDownloadInfoDownloadSize')}
              </span>
              {downloadSizeEstimates ? (
                <span className='downloadSummaryValue'>
                  {`${bytes(dataTotal.filteredSize)} / ${bytes(dataTotal.unfilteredSize)}`}
                </span>
              ) : (
                <Spinner
                  className='datasetSizeTotalSpinner'
                  as='span'
                  animation='border'
                  role='status'
                  aria-hidden='true'
                />
              )}
            </div>
          </div>
        </Col>
        {children}
      </Row>
    </Container>
  )
}
