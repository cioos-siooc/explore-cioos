import React, { useState, useEffect } from 'react'
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

  const changeLanguage = (lng) => {
    i18n.changeLanguage(lng)
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
          href={`${row.erddap_url}/tabledap/${row.dataset_id}.html`}
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
          href={`${row.erddap_url}/tabledap/${row.dataset_id}.html`}
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

  // Filter data based on filterText
  const filteredData = harvestData.filter((row) => {
    if (!filterText) return true
    const searchText = filterText.toLowerCase()
    return (
      (row.dataset_id && row.dataset_id.toLowerCase().includes(searchText)) ||
      (row.erddap_url && row.erddap_url.toLowerCase().includes(searchText)) ||
      (row.title && row.title.toLowerCase().includes(searchText)) ||
      (row.cdm_data_type && row.cdm_data_type.toLowerCase().includes(searchText)) ||
      (row.platform && row.platform.toLowerCase().includes(searchText)) ||
      (row.status && row.status.toLowerCase().includes(searchText)) ||
      (row.error_message && row.error_message.toLowerCase().includes(searchText))
    )
  })

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
          <span className="stat-value">{harvestData.length}</span>
        </div>
        <div className="summary-stat success">
          <span className="stat-label">{t('harvestResults.successful')}:</span>
          <span className="stat-value">{successCount}</span>
        </div>
        <div className="summary-stat failed">
          <span className="stat-label">{t('harvestResults.failed')}:</span>
          <span className="stat-value">{failedCount}</span>
        </div>
      </div>

      <div className="harvest-results-table">
        <div className="custom-filter-section">
          <input
            type="text"
            placeholder={t('harvestResults.filterPlaceholder') || 'Filter by any column...'}
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
