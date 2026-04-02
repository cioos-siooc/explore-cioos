import { useState, useEffect } from 'react'
import DataTable from 'react-data-table-component'
import { useTranslation } from 'react-i18next'
import { server } from '../../../config'
import './styles.css'

export default function HarvestResults({ onClose }) {
  const { t, i18n } = useTranslation()
  const [harvestData, setHarvestData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filterText, setFilterText] = useState('')
  const [filterErddapUrl, setFilterErddapUrl] = useState('')
  const [filterCdmDataType, setFilterCdmDataType] = useState('')
  const [filterPlatform, setFilterPlatform] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const changeLanguage = (lng) => {
    i18n.changeLanguage(lng)
  }

  // Ensure URL has protocol prefix
  const getFullUrl = (url) => {
    if (!url) return ''
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url
    }
    return `https://${url}`
  }

  useEffect(() => {
    setLoading(true)
    setError(null)

    fetch(`${server}/harvestResults`)
      .then((response) => {
        if (!response.ok) {
          throw new Error('Failed to fetch harvest results')
        }
        return response.json()
      })
      .then((data) => {
        setHarvestData(data)
        setLoading(false)
      })
      .catch((err) => {
        console.error('Error fetching harvest results:', err)
        setError(err.message)
        setLoading(false)
      })
  }, [])

  const columns = [
    {
      name: t('harvestResults.erddapUrl'),
      selector: (row) => row.erddap_url,
      sortable: true,
      wrap: true,
      minWidth: '250px',
      cell: (row) => (
        <a
          href={`${getFullUrl(row.erddap_url)}/tabledap/${row.dataset_id}.html`}
          target="_blank"
          rel="noopener noreferrer"
          className="erddap-link"
        >
          {row.erddap_url}
        </a>
      ),
    },
    {
      name: t('harvestResults.datasetId'),
      selector: (row) => row.dataset_id,
      sortable: true,
      wrap: true,
      minWidth: '200px',
      cell: (row) => (
        <a
          href={`${getFullUrl(row.erddap_url)}/tabledap/${row.dataset_id}.html`}
          target="_blank"
          rel="noopener noreferrer"
          className="erddap-link"
        >
          {row.dataset_id}
        </a>
      ),
    },
    {
      name: t('harvestResults.datasetTitle'),
      selector: (row) => row.title || '-',
      sortable: true,
      wrap: true,
      minWidth: '250px',
    },
    {
      name: t('harvestResults.cdmDataType'),
      selector: (row) => row.cdm_data_type || '-',
      sortable: true,
      minWidth: '150px',
    },
    {
      name: t('harvestResults.platform'),
      selector: (row) => row.platform || '-',
      sortable: true,
      minWidth: '120px',
    },
    {
      name: t('harvestResults.profileCount'),
      selector: (row) => row.n_profiles !== null ? row.n_profiles : '-',
      sortable: true,
      right: true,
      minWidth: '100px',
    },
    {
      name: t('harvestResults.status'),
      selector: (row) => row.status,
      sortable: true,
      minWidth: '100px',
      cell: (row) => (
        <span className={`status-badge status-${row.status}`}>
          {t(`harvestResults.statusValues.${row.status}`)}
        </span>
      ),
    },
    {
      name: t('harvestResults.error'),
      selector: (row) => row.error_message || '-',
      sortable: true,
      wrap: true,
      minWidth: '300px',
      cell: (row) => {
        if (!row.error_message) return '-'

        // Split error message into code and details
        const parts = row.error_message.split('\n\n')
        const errorCode = parts[0]
        const errorDetails = parts.slice(1).join('\n\n')

        return (
          <div className="error-cell">
            <div className="error-code">{errorCode}</div>
            {errorDetails && (
              <details className="error-details">
                <summary>{t('harvestResults.showDetails')}</summary>
                <pre className="error-trace">{errorDetails}</pre>
              </details>
            )}
          </div>
        )
      },
    },
  ]

  const customStyles = {
    headCells: {
      style: {
        fontWeight: 'bold',
        fontSize: '14px',
      },
    },
    cells: {
      style: {
        fontSize: '13px',
      },
    },
  }

  if (loading) {
    return (
      <div className="harvest-results-container">
        <div className="harvest-results-header">
          <h2>{t('harvestResults.title')}</h2>
          {onClose && (
            <button onClick={onClose} className="close-button">
              ×
            </button>
          )}
        </div>
        <div className="loading-message">{t('harvestResults.loading')}</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="harvest-results-container">
        <div className="harvest-results-header">
          <h2>{t('harvestResults.title')}</h2>
          {onClose && (
            <button onClick={onClose} className="close-button">
              ×
            </button>
          )}
        </div>
        <div className="error-message">
          {t('harvestResults.errorLoading')}: {error}
        </div>
      </div>
    )
  }

  const successCount = harvestData.filter((d) => d.status === 'success').length
  const failedCount = harvestData.filter((d) => d.status === 'failed').length

  // Extract unique values for dropdown filters
  const uniqueErddapUrls = [...new Set(harvestData.map((row) => row.erddap_url).filter(Boolean))].sort()
  const uniqueCdmDataTypes = [...new Set(harvestData.map((row) => row.cdm_data_type).filter(Boolean))].sort()
  const uniquePlatforms = [...new Set(harvestData.map((row) => row.platform).filter(Boolean))].sort()
  const uniqueStatuses = [...new Set(harvestData.map((row) => row.status).filter(Boolean))].sort()

  // Column aliases for search syntax
  const columnAliases = {
    id: 'dataset_id',
    dataset_id: 'dataset_id',
    dataset: 'dataset_id',
    erddap: 'erddap_url',
    url: 'erddap_url',
    title: 'title',
    cdm: 'cdm_data_type',
    type: 'cdm_data_type',
    platform: 'platform',
    status: 'status',
    error: 'error_message',
  }

  // Check if a single condition matches a row
  const matchesCondition = (row, condition) => {
    const trimmed = condition.trim().toLowerCase()
    if (!trimmed) return true

    // Check for column:value syntax
    const colonIndex = trimmed.indexOf(':')
    if (colonIndex > 0) {
      const columnKey = trimmed.substring(0, colonIndex).trim()
      const searchValue = trimmed.substring(colonIndex + 1).trim()
      const columnName = columnAliases[columnKey]

      if (columnName && searchValue) {
        const cellValue = row[columnName]
        return cellValue && cellValue.toLowerCase().includes(searchValue)
      }
    }

    // No column prefix - search all columns
    return (
      (row.dataset_id && row.dataset_id.toLowerCase().includes(trimmed)) ||
      (row.erddap_url && row.erddap_url.toLowerCase().includes(trimmed)) ||
      (row.title && row.title.toLowerCase().includes(trimmed)) ||
      (row.cdm_data_type && row.cdm_data_type.toLowerCase().includes(trimmed)) ||
      (row.platform && row.platform.toLowerCase().includes(trimmed)) ||
      (row.status && row.status.toLowerCase().includes(trimmed)) ||
      (row.error_message && row.error_message.toLowerCase().includes(trimmed))
    )
  }

  // Parse and evaluate search query with AND/OR logic
  const matchesSearchQuery = (row, query) => {
    if (!query || !query.trim()) return true

    // Split by OR first (lower precedence), then by AND (higher precedence)
    // Support both words and symbols: OR/|, AND/&
    const orParts = query.split(/\s+OR\s+|\s*\|\s*/i)

    return orParts.some((orPart) => {
      // Each OR part is evaluated with AND logic
      const andParts = orPart.split(/\s+AND\s+|\s*&\s*/i)
      return andParts.every((condition) => matchesCondition(row, condition))
    })
  }

  // Filter data based on filterText and dropdown filters
  const filteredData = harvestData.filter((row) => {
    // Check dropdown filters first
    if (filterErddapUrl && row.erddap_url !== filterErddapUrl) return false
    if (filterCdmDataType && row.cdm_data_type !== filterCdmDataType) return false
    if (filterPlatform && row.platform !== filterPlatform) return false
    if (filterStatus && row.status !== filterStatus) return false

    // Then check text filter with advanced syntax
    return matchesSearchQuery(row, filterText)
  })

  // Clear all filters
  const clearAllFilters = () => {
    setFilterText('')
    setFilterErddapUrl('')
    setFilterCdmDataType('')
    setFilterPlatform('')
    setFilterStatus('')
  }

  const hasActiveFilters = filterText || filterErddapUrl || filterCdmDataType || filterPlatform || filterStatus

  return (
    <div className="harvest-results-container">
      <div className="harvest-results-header">
        <h2>{t('harvestResults.title')}</h2>
        <div className="header-controls">
          <div className="language-selector">
            <button
              className={`lang-button ${i18n.language === 'en' ? 'active' : ''}`}
              onClick={() => changeLanguage('en')}
            >
              EN
            </button>
            <button
              className={`lang-button ${i18n.language === 'fr' ? 'active' : ''}`}
              onClick={() => changeLanguage('fr')}
            >
              FR
            </button>
          </div>
          {onClose && (
            <button onClick={onClose} className="close-button">
              ×
            </button>
          )}
        </div>
      </div>

      <div className="harvest-summary">
        <div className="summary-stat">
          <span className="stat-label">{t('harvestResults.total')}:</span>
          <span className="stat-value">
            {hasActiveFilters ? `${filteredData.length} / ${harvestData.length}` : harvestData.length}
          </span>
        </div>
        <div className="summary-stat success">
          <span className="stat-label">{t('harvestResults.successful')}:</span>
          <span className="stat-value">
            {hasActiveFilters
              ? `${filteredData.filter((d) => d.status === 'success').length} / ${successCount}`
              : successCount}
          </span>
        </div>
        <div className="summary-stat failed">
          <span className="stat-label">{t('harvestResults.failed')}:</span>
          <span className="stat-value">
            {hasActiveFilters
              ? `${filteredData.filter((d) => d.status === 'failed').length} / ${failedCount}`
              : failedCount}
          </span>
        </div>
      </div>

      <div className="harvest-results-table">
        <div className="filter-section">
          <div className="dropdown-filters">
            <div className="filter-group">
              <label htmlFor="filter-erddap">{t('harvestResults.erddapUrl')}</label>
              <select
                id="filter-erddap"
                value={filterErddapUrl}
                onChange={(e) => setFilterErddapUrl(e.target.value)}
                className="filter-dropdown"
              >
                <option value="">{t('harvestResults.allValues') || 'All'}</option>
                {uniqueErddapUrls.map((url) => (
                  <option key={url} value={url}>{url}</option>
                ))}
              </select>
            </div>

            <div className="filter-group">
              <label htmlFor="filter-cdm">{t('harvestResults.cdmDataType')}</label>
              <select
                id="filter-cdm"
                value={filterCdmDataType}
                onChange={(e) => setFilterCdmDataType(e.target.value)}
                className="filter-dropdown"
              >
                <option value="">{t('harvestResults.allValues') || 'All'}</option>
                {uniqueCdmDataTypes.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            <div className="filter-group">
              <label htmlFor="filter-platform">{t('harvestResults.platform')}</label>
              <select
                id="filter-platform"
                value={filterPlatform}
                onChange={(e) => setFilterPlatform(e.target.value)}
                className="filter-dropdown"
              >
                <option value="">{t('harvestResults.allValues') || 'All'}</option>
                {uniquePlatforms.map((platform) => (
                  <option key={platform} value={platform}>{platform}</option>
                ))}
              </select>
            </div>

            <div className="filter-group">
              <label htmlFor="filter-status">{t('harvestResults.status')}</label>
              <select
                id="filter-status"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="filter-dropdown"
              >
                <option value="">{t('harvestResults.allValues') || 'All'}</option>
                {uniqueStatuses.map((status) => (
                  <option key={status} value={status}>{t(`harvestResults.statusValues.${status}`) || status}</option>
                ))}
              </select>
            </div>

            {hasActiveFilters && (
              <button
                onClick={clearAllFilters}
                className="clear-all-filters-button"
              >
                {t('harvestResults.clearFilters') || 'Clear all filters'}
              </button>
            )}
          </div>

          <div className="text-filter-section">
            <div className="text-filter-input-wrapper">
              <input
                type="text"
                placeholder={t('harvestResults.filterPlaceholder') || 'Search across all columns...'}
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                className="custom-filter-input"
              />
              {filterText && (
                <button
                  onClick={() => setFilterText('')}
                  className="clear-filter-button"
                  title="Clear filter"
                >
                  ×
                </button>
              )}
            </div>
            <p className="filter-help-text">
              {t('harvestResults.filterHelpText') || 'Search across Dataset ID, ERDDAP URL, Title, CDM Type, Platform, Status, and Error messages'}
            </p>
          </div>
        </div>
        <DataTable
          columns={columns}
          data={filteredData}
          pagination
          paginationPerPage={50}
          paginationRowsPerPageOptions={[50, 100, 150, 200]}
          highlightOnHover
          customStyles={customStyles}
          dense
          filterPlaceholder={t('harvestResults.filterPlaceholder') || 'Filter by any column...'}
          filter
          export
        />
      </div>
    </div>
  )
}
