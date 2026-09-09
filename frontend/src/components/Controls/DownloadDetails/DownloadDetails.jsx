import * as React from 'react'
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'
import bytes from 'bytes'

import DatasetsTable from '../DatasetsTable/DatasetsTable.jsx'
import polygonImage from '../../Images/polygonIcon.png'
import rectangleImage from '../../Images/rectangleIcon.png'
import isEmpty from 'lodash/isEmpty'

import { useActivityTask } from '../../../state/activity/ActivityProvider.jsx'

import {
  createDataFilterQueryString,
  polygonIsRectangle
} from '../../../utilities.jsx'
import {
  defaultEndDate,
  defaultEndDepth,
  defaultStartDate,
  defaultStartDepth
} from '../../config.js'
import { server } from '../../../config.js'
import reportError from '../../../state/reportError.js'
import './styles.css'
import {
  ArrowsExpand,
  CalendarWeek,
  Check2Circle,
  XCircle
} from 'react-bootstrap-icons'
import QuestionIconTooltip from '../QuestionIconTooltip/QuestionIconTooltip.jsx'
import Spinner from '../../ui/Spinner.jsx'

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
    pointsToReview
      // defensive: griddap datasets are metadata-only and must never reach
      // the size-estimate / download-queue flow
      .filter((ptr) => ptr.cdm_data_type !== 'Grid')
      .map((ptr) => {
        return { ...ptr, downloadDisabled: false }
      })
  )
  const [dataTotal, setDataTotal] = useState(0)
  const [downloadSizeEstimates, setDownloadSizeEstimates] = useState()
  // Three states, not two: estimates in flight (spinner), estimates in
  // (sizes), estimates failed (no sizes, no spinner). The old code threw from
  // its catch handlers, which skipped the setLoading(false) chained after
  // them — a failing /downloadEstimate spun forever, in every card and in the
  // order summary.
  const [estimatesLoading, setEstimatesLoading] = useState(true)
  // Reported by the corner badge as well as by the figures it stands in for:
  // the estimate is the slowest thing in this modal and the user may well
  // have looked away from it.
  useActivityTask('activityEstimatesText', estimatesLoading)

  useEffect(() => {
    let cancelled = false
    setEstimatesLoading(true)
    setDownloadSizeEstimates()

    const unfilteredUrl = `${server}/downloadEstimate?&datasetPKs=${pointsData
      .map((ds) => ds.pk)
      .join(',')}`
    // The download can be narrowed by any of the active filters; when none of
    // them applies, the unfiltered estimate is the estimate.
    const isFiltered =
      filterDownloadByPolygon || filterDownloadByTime || filterDownloadByDepth
    let filteredUrl = unfilteredUrl
    if (isFiltered) {
      if (polygon && filterDownloadByPolygon) {
        filteredUrl += `&polygon=${JSON.stringify(polygon)}`
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
        filteredUrl += `&${createDataFilterQueryString(tempQuery)}`
      }
    }

    const fetchEstimates = (url) =>
      fetch(url).then((response) => {
        if (!response.ok) {
          throw new Error(`downloadEstimate failed: ${response.status}`)
        }
        return response.json()
      })

    Promise.all([
      fetchEstimates(unfilteredUrl),
      isFiltered ? fetchEstimates(filteredUrl) : undefined
    ])
      .then(([unfiltered, filtered]) => {
        if (cancelled) return
        const unfilteredSizeByPk = new Map(unfiltered.map((e) => [e.pk, e.size]))
        setDownloadSizeEstimates(
          (filtered || unfiltered).map((e) => ({
            ...e,
            unfilteredSize: unfilteredSizeByPk.get(e.pk) ?? e.size
          }))
        )
      })
      .catch((error) => {
        reportError('download size estimate failed', error)
      })
      .finally(() => {
        if (!cancelled) setEstimatesLoading(false)
      })

    setSubmissionState()
    return () => {
      cancelled = true
    }
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
      const estimateByPk = new Map(
        downloadSizeEstimates.map((dse) => [dse.pk, dse])
      )
      const tempData = pointsData.map((ds) => {
        // A dataset the estimate response didn't cover reads as 0 bytes rather
        // than throwing — it stays listed, just without a usable size.
        const tempDS = estimateByPk.get(ds.pk) || { size: 0, unfilteredSize: 0 }
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
    <div className='container downloadDetails'>
      <div className='filterDownloadToggles'>
        <span className='filterDownloadTogglesTitle'>
          {t('downloadDetailsFilterSectionTitle')}
          <QuestionIconTooltip
            tooltipText={t('downloadDetailsFilterQuestionTooltipText')}
            tooltipPlacement={'right'}
            size={16}
          />
        </span>
        <div className='filterDownloadTogglesChips'>
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
      </div>

      <div className='row downloadDataRow'>
        <div className='col'>
          <DatasetsTable
            isDownloadModal
            handleSelectAllDatasets={handleSelectAllDatasets}
            handleSelectDataset={handleSelectDataset}
            selectAll={selectAll}
            setDatasets={setPointsData}
            datasets={pointsData}
            setHoveredDataset={setHoveredDataset}
            downloadSizeEstimates={downloadSizeEstimates}
            estimatesLoading={estimatesLoading}
          />
        </div>
      </div>

      <div className='downloadLegend'>
        <span className='downloadLegendItem'>
          <Check2Circle className='legendIcon success' size={16} aria-hidden='true' />
          <span className='legendBadge success'>
            {t('downloadDetailsDownloadLimitsDownloadableMessagePart2')}
          </span>
          {t('downloadDetailsDownloadLimitsDownloadableMessagePart3')}
        </span>
        <span className='downloadLegendItem'>
          <XCircle className='legendIcon error' size={16} aria-hidden='true' />
          <span className='legendBadge error'>
            {t('downloadDetailsDownloadLimitsNotDownloadableMessagePart2')}
          </span>
          {t('downloadDetailsDownloadLimitsNotDownloadableMessagePart3')}
        </span>
      </div>

      <div className='downloadOrderBar'>
        <div className='downloadSummary'>
          {/* The estimates decide which datasets are downloadable, hence how
              many stay selected — so both stats wait for them rather than
              showing a count that is about to change under the user. If they
              fail outright, the sizes are unknowable but the counts aren't. */}
          <div className='downloadSummaryStat'>
            {estimatesLoading ? (
              <Spinner size='sm' className='datasetSizeTotalSpinner' />
            ) : (
              <span className='downloadSummaryValue'>
                {selectedCount}
                <span className='downloadSummaryValueMuted'>{` / ${pointsData.length}`}</span>
              </span>
            )}
            <span className='downloadSummaryLabel'>
              {t('downloadDetailsDownloadInfoDatasets')}
            </span>
          </div>
          <div className='downloadSummaryDivider' aria-hidden='true' />
          <div className='downloadSummaryStat'>
            {estimatesLoading ? (
              <Spinner size='sm' className='datasetSizeTotalSpinner' />
            ) : downloadSizeEstimates ? (
              <span className='downloadSummaryValue'>
                {bytes(dataTotal.filteredSize) || '0B'}
                <span className='downloadSummaryValueMuted'>{` / ${bytes(dataTotal.unfilteredSize) || '0B'}`}</span>
              </span>
            ) : (
              <span
                className='downloadSummaryValue downloadSummaryValueMuted'
                title={t('downloadSizeUnavailableTitle')}
              >
                {t('downloadSizeUnavailable')}
              </span>
            )}
            <span className='downloadSummaryLabel'>
              {t('downloadDetailsDownloadInfoDownloadSize')}
            </span>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}
