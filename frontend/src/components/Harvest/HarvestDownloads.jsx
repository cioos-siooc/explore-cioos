import React, { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import HarvestLayout from './HarvestLayout.jsx'
import useHarvestFetch from './useHarvestFetch.js'
import { datasetBadgeClass, jobBadgeClass, datasetReason } from './downloadStatus.js'
import { hostname, fmtDt, fmtDurationS, fmtBytes, datasetLink } from './format.js'

// An 'open' or 'downloading' job that has sat past this is the shape of a
// scheduler that isn't running: requests are accepted, nothing consumes them,
// and the requester never gets their email. Worth calling out loudly, since
// nothing else in the UI reveals it.
function QueueWarning({ summary, t }) {
  const stuck = Number(summary.n_stuck || 0) + Number(summary.n_stalled || 0)
  if (!stuck) return null
  return (
    <div className="harvest-queue-warning">
      {t('harvest.downloads.queueStalled', { count: stuck })}
    </div>
  )
}

function SummaryBar({ summary, t }) {
  if (!summary) return null
  return (
    <div className="harvest-card-counts" style={{ marginBottom: '1rem' }}>
      <span className="harvest-count-pill harvest-count-success">
        ✓ {summary.n_completed} {t('harvest.downloads.completed')}
      </span>
      <span className="harvest-count-pill harvest-count-error">
        ✗ {summary.n_failed} {t('harvest.downloads.failed')}
      </span>
      <span className="harvest-count-pill harvest-count-unchanged">
        {summary.n_open} {t('harvest.downloads.queued')}
      </span>
      <span className="harvest-muted" style={{ fontSize: '0.8rem', alignSelf: 'center' }}>
        {t('harvest.downloads.lastRequest', { date: fmtDt(summary.last_request_at) })}
      </span>
    </div>
  )
}

function DatasetRow({ row, t }) {
  const isObis = (row.erddap_url || '').includes('obis.org')
  const reason = datasetReason(t, row)
  return (
    <tr>
      <td>
        <a
          href={datasetLink(row.erddap_url, row.dataset_id, isObis ? 'obis' : 'erddap')}
          target="_blank"
          rel="noreferrer"
          className="harvest-link"
        >
          {row.dataset_id}
        </a>
        {reason && (
          <div
            className="harvest-muted"
            style={{ fontSize: '0.72rem', color: '#7a1520', marginTop: '2px' }}
            title={reason}
          >
            {reason.slice(0, 110)}{reason.length > 110 ? '…' : ''}
          </div>
        )}
      </td>
      <td className="harvest-muted" style={{ fontSize: '0.82rem' }} title={row.erddap_url}>
        {isObis ? 'OBIS' : hostname(row.erddap_url)}
      </td>
      <td>
        <span className={`harvest-status harvest-status-${datasetBadgeClass(row.last_status)}`}>
          {row.last_status}
        </span>
      </td>
      <td style={{ textAlign: 'right' }}>{row.n_attempts}</td>
      <td style={{ textAlign: 'right' }}>{row.n_ok}</td>
      <td style={{ textAlign: 'right', color: Number(row.n_failed) > 0 ? '#7a1520' : undefined }}>
        {row.n_failed}
      </td>
      <td className="harvest-muted" style={{ textAlign: 'right' }}>{row.n_empty}</td>
      <td className="harvest-muted" style={{ textAlign: 'right' }}>{row.n_ignored}</td>
      <td style={{ textAlign: 'right' }}>{fmtBytes(row.total_bytes)}</td>
      <td className="harvest-muted" style={{ fontSize: '0.82rem' }}>{fmtDt(row.last_attempt_at)}</td>
    </tr>
  )
}

export default function HarvestDownloads() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || '')
  const [q, setQ] = useState(searchParams.get('q') || '')

  const activeStatus = searchParams.get('status') || ''
  const activeQ = searchParams.get('q') || ''
  const query = new URLSearchParams()
  if (activeStatus) query.set('status', activeStatus)
  if (activeQ) query.set('q', activeQ)
  const qs = query.toString()

  const { data: summary } = useHarvestFetch('/downloads/summary', [])
  const { data: jobs, loading: loadingJobs } = useHarvestFetch('/downloads/recent', [])
  const { data: datasets, loading: loadingDatasets } = useHarvestFetch(
    `/downloads/datasets${qs ? `?${qs}` : ''}`,
    [qs]
  )

  function applyFilters(status, search) {
    const params = new URLSearchParams(searchParams)
    if (status) params.set('status', status); else params.delete('status')
    if (search) params.set('q', search); else params.delete('q')
    setSearchParams(params)
  }

  const breadcrumbs = (
    <Link to="/harvest" className="harvest-link">{t('harvest.title')}</Link>
  )

  return (
    <HarvestLayout breadcrumbs={breadcrumbs}>
      <h1 className="harvest-page-title">{t('harvest.downloads.title')}</h1>
      <p className="harvest-page-sub">{t('harvest.downloads.subtitle')}</p>

      {summary && <QueueWarning summary={summary} t={t} />}
      <SummaryBar summary={summary} t={t} />

      <h2 className="harvest-section-title">{t('harvest.downloads.datasetsTitle')}</h2>

      <div className="harvest-filter-bar">
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); applyFilters(e.target.value, q) }}
        >
          <option value="">{t('harvest.filter.allStatuses')}</option>
          <option value="COMPLETED">COMPLETED</option>
          <option value="PARTIAL">PARTIAL</option>
          <option value="FAILED">FAILED</option>
          <option value="EMPTY">EMPTY</option>
          <option value="IGNORED">IGNORED</option>
        </select>
        <input
          type="text"
          placeholder={t('harvest.downloads.searchPlaceholder')}
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') applyFilters(statusFilter, q) }}
        />
        <button
          onClick={() => applyFilters(statusFilter, q)}
          style={{ padding: '0.35rem 0.8rem', fontSize: '0.85rem', cursor: 'pointer' }}
        >
          {t('harvest.filter.search')}
        </button>
        {(statusFilter || q) && (
          <button
            onClick={() => { setStatusFilter(''); setQ(''); applyFilters('', '') }}
            style={{ padding: '0.35rem 0.8rem', fontSize: '0.85rem', cursor: 'pointer' }}
          >
            {t('harvest.filter.clear')}
          </button>
        )}
      </div>

      {loadingDatasets
        ? <div className="harvest-loading">{t('harvest.loading.datasets')}</div>
        : (datasets || []).length === 0
          ? <div className="harvest-muted">{t('harvest.downloads.noDatasets')}</div>
          : <table className="harvest-table">
              <thead>
                <tr>
                  <th>{t('harvest.col.datasetId')}</th>
                  <th>{t('harvest.col.server')}</th>
                  <th>{t('harvest.downloads.col.lastOutcome')}</th>
                  <th style={{ textAlign: 'right' }}>{t('harvest.downloads.col.requests')}</th>
                  <th style={{ textAlign: 'right' }}>{t('harvest.col.ok')}</th>
                  <th style={{ textAlign: 'right' }}>{t('harvest.col.error')}</th>
                  <th style={{ textAlign: 'right' }}>{t('harvest.downloads.col.empty')}</th>
                  <th style={{ textAlign: 'right' }}>{t('harvest.downloads.col.ignored')}</th>
                  <th style={{ textAlign: 'right' }}>{t('harvest.downloads.col.bytes')}</th>
                  <th>{t('harvest.downloads.col.lastRequested')}</th>
                </tr>
              </thead>
              <tbody>
                {(datasets || []).map(row => (
                  <DatasetRow key={`${row.erddap_url}|${row.dataset_id}`} row={row} t={t} />
                ))}
              </tbody>
            </table>
      }

      <h2 className="harvest-section-title">{t('harvest.downloads.requestsTitle')}</h2>
      {loadingJobs
        ? <div className="harvest-loading">{t('harvest.loading')}</div>
        : <table className="harvest-table">
            <thead>
              <tr>
                <th>{t('harvest.col.when')}</th>
                <th>{t('harvest.col.status')}</th>
                <th style={{ textAlign: 'right' }}>{t('harvest.col.datasets')}</th>
                <th style={{ textAlign: 'right' }}>{t('harvest.col.ok')}</th>
                <th style={{ textAlign: 'right' }}>{t('harvest.col.error')}</th>
                <th style={{ textAlign: 'right' }}>{t('harvest.downloads.col.size')}</th>
                <th>{t('harvest.col.duration')}</th>
              </tr>
            </thead>
            <tbody>
              {(jobs || []).map(j => (
                <tr key={j.pk}>
                  <td style={{ fontSize: '0.82rem' }}>
                    <Link to={`/harvest/downloads/${j.job_id}`} className="harvest-link">
                      {fmtDt(j.time)}
                    </Link>
                    {j.error_message && (
                      <div
                        style={{ fontSize: '0.72rem', color: '#7a1520', marginTop: '2px' }}
                        title={j.error_message}
                      >
                        {j.error_message.slice(0, 80)}{j.error_message.length > 80 ? '…' : ''}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`harvest-status harvest-status-${jobBadgeClass(j.status)}`}>
                      {j.status}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{j.n_datasets}</td>
                  <td style={{ textAlign: 'right' }}>{j.n_ok}</td>
                  <td style={{ textAlign: 'right', color: Number(j.n_failed) > 0 ? '#7a1520' : undefined }}>
                    {j.n_failed}
                  </td>
                  <td style={{ textAlign: 'right' }}>{fmtBytes(j.download_size)}</td>
                  <td className="harvest-muted" style={{ fontSize: '0.82rem' }}>
                    {fmtDurationS(j.duration_s)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
      }
    </HarvestLayout>
  )
}
