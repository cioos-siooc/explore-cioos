import * as React from 'react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GraphUp } from 'react-bootstrap-icons'

import Modal from '../../ui/Modal.jsx'
import Spinner from '../../ui/Spinner.jsx'
import { Dropdown, DropdownButton } from '../../ui/Dropdown.jsx'
import { useUI } from '../../../state/ui/UIProvider.jsx'
import { useFilters } from '../../../state/filters/FilterProvider.jsx'
import { createDataFilterQueryString } from '../../../utilities.jsx'
import { server } from '../../../config.js'
import './styles.css'

// The Plotly chunk is ~1.4MB, so the histogram only loads once the modal is
// actually opened — same pattern as DatasetPreview.
const CoverageHistogramPlot = lazy(() =>
  import('../../Controls/CoverageHistogramPlot/CoverageHistogramPlot.jsx')
)

// The dimensions the bars can be split (coloured) by. Keys match the API's
// groupBy values.
const GROUP_OPTIONS = ['source', 'platform', 'dataType']

// What the bars count. Keys match the API's metric values.
const METRIC_OPTIONS = ['datasets', 'features']

// The dataset-coverage figure, launched from the top bar: a histogram of how
// many datasets match the applied filters over time, with the bars split by a
// chosen dimension. Depth is handled by the filter, not drawn as an axis.
export default function CoverageModal () {
  const { t } = useTranslation()
  const { showCoverageModal, setShowCoverageModal } = useUI()
  const { query } = useFilters()
  const [groupBy, setGroupBy] = useState('source')
  const [metric, setMetric] = useState('datasets')
  const [histogram, setHistogram] = useState()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  // Fetch only while the modal is open; refetch when the applied filters or
  // the chosen grouping change so the figure always matches the map + control.
  useEffect(() => {
    if (!showCoverageModal) return
    const controller = new AbortController()
    setLoading(true)
    setError(false)
    const filterString = createDataFilterQueryString(query)
    fetch(
      `${server}/coverageHistogram?groupBy=${groupBy}&metric=${metric}&${filterString}`,
      { signal: controller.signal }
    )
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })
      .then((data) => {
        setHistogram(data)
        setLoading(false)
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setError(true)
        setLoading(false)
      })
    return () => controller.abort()
  }, [showCoverageModal, query, groupBy, metric])

  const isEmpty = histogram && histogram.cells.length === 0

  return (
    <Modal
      show={showCoverageModal}
      onHide={() => setShowCoverageModal(false)}
      className='coverageModal'
      dialogClassName='coverageModalDialog'
      aria-labelledby='coverageModalTitle'
    >
      <Modal.Header closeButton>
        <Modal.Title id='coverageModalTitle'>
          <span className='downloadModalTitleIcon' aria-hidden='true'>
            <GraphUp size={20} />
          </span>
          <span className='downloadModalTitleText'>
            <span className='downloadModalTitleHeading'>
              {t('coverageModalTitleText')}
            </span>
            <span className='downloadModalTitleSubtitle'>
              {t('coverageModalSubtitleText')}
            </span>
          </span>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className='coverageToolbar'>
          <span className='coverageToolbarLabel'>{t('coverageCountByLabel')}</span>
          <DropdownButton title={t(`coverageMetric_${metric}`)}>
            {METRIC_OPTIONS.map((option) => (
              <Dropdown.Item
                key={option}
                active={option === metric}
                onClick={() => setMetric(option)}
              >
                {t(`coverageMetric_${option}`)}
              </Dropdown.Item>
            ))}
          </DropdownButton>
          <span className='coverageToolbarLabel'>{t('coverageColorByLabel')}</span>
          <DropdownButton title={t(`coverageGroup_${groupBy}`)}>
            {GROUP_OPTIONS.map((option) => (
              <Dropdown.Item
                key={option}
                active={option === groupBy}
                onClick={() => setGroupBy(option)}
              >
                {t(`coverageGroup_${option}`)}
              </Dropdown.Item>
            ))}
          </DropdownButton>
        </div>
        <div className='coveragePlotArea'>
          {loading && (
            <div className='coverageModalStatus'>
              <Spinner />
            </div>
          )}
          {!loading && error && (
            <div className='coverageModalStatus'>
              {t('coverageErrorMessage')}
            </div>
          )}
          {!loading && !error && isEmpty && (
            <div className='coverageModalStatus'>
              {t('coverageEmptyMessage')}
            </div>
          )}
          {!loading && !error && histogram && !isEmpty && (
            <Suspense
              fallback={
                <div className='coverageModalStatus'>
                  <Spinner />
                </div>
              }
            >
              <CoverageHistogramPlot histogram={histogram} />
            </Suspense>
          )}
        </div>
      </Modal.Body>
    </Modal>
  )
}
