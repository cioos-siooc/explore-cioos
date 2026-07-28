import * as React from 'react'
import { ExclamationTriangle, ArrowClockwise } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import { useFilters } from '../../state/filters/FilterProvider.jsx'
import { useMapState } from '../../state/map/MapStateProvider.jsx'

// Shown when the catalog fetches failed (e.g. API gateway timeouts): the
// filters and dataset list would otherwise sit silently empty.
export default function ApiErrorBanner () {
  const { t } = useTranslation()
  const { catalogError, loadCatalog } = useFilters()
  const { loadLegend } = useMapState()

  if (!catalogError) return null

  return (
    <div className='apiErrorBanner' role='alert'>
      <ExclamationTriangle size={18} aria-hidden='true' />
      <span>{t('apiErrorBannerText')}</span>
      <button
        type='button'
        onClick={() => {
          loadCatalog()
          loadLegend()
        }}
      >
        <ArrowClockwise size={14} aria-hidden='true' />
        {t('apiErrorRetryButton')}
      </button>
    </div>
  )
}
