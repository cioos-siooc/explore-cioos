import React, { useState } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import HarvestLayout from './HarvestLayout.jsx'
import StatusBadge from './StatusBadge.jsx'
import HarvestModeBadge from './HarvestModeBadge.jsx'
import Sparkline from './Sparkline.jsx'
import useHarvestFetch from './useHarvestFetch.js'
import reasonLabel from './reasonLabel.js'
import { harvestMode } from './harvestMode.js'
import { unslug, slugify } from './slug.js'
import { hostname, fmtDt, fmtDurationMs, datasetLink } from './format.js'

export default function HarvestServer() {
  const { t } = useTranslation()
  const { slug } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || '')
  const [q, setQ] = useState(searchParams.get('q') || '')

  const erddapUrl = unslug(slug)
  const host = hostname(erddapUrl)

  const qs = new URLSearchParams()
  if (statusFilter) qs.set('status', statusFilter)
  if (q) qs.set('q', q)
  const queryStr = qs.toString()

  const { data: datasets, loading } = useHarvestFetch(
    `/servers/${slug}${queryStr ? '?' + queryStr : ''}`,
    [slug, statusFilter, q]
  )
  const { data: reasons } = useHarvestFetch(`/reasons/${slug}`, [slug])

  function applyFilters(newStatus, newQ) {
    const p = {}
    if (newStatus) p.status = newStatus
    if (newQ) p.q = newQ
    setSearchParams(p)
  }

  const summary = (datasets || []).reduce(
    (acc, d) => { acc[d.status] = (acc[d.status] || 0) + 1; acc.total++; return acc },
    { success: 0, skipped: 0, error: 0, total: 0 }
  )
  const nIncremental = (datasets || []).filter(d => harvestMode(d) === 'incremental').length

  const breadcrumbs = (
    <><Link to="/harvest">{t('harvest.title')}</Link> / {host}</>
  )

  return (
    <HarvestLayout breadcrumbs={breadcrumbs}>
      <h1 className="harvest-page-title">{host}</h1>
      <p className="harvest-page-sub">
        <a href={erddapUrl} target="_blank" rel="noreferrer" className="harvest-link">{erddapUrl}</a>
      </p>

      <div className="harvest-summary">
        <span className="harvest-count-pill harvest-count-success">✓ {summary.success} {t('harvest.filter.success').toLowerCase()}</span>
        <span className="harvest-count-pill harvest-count-skipped">· {summary.skipped} {t('harvest.filter.skipped').toLowerCase()}</span>
        <span className="harvest-count-pill harvest-count-error">✗ {summary.error} {t('harvest.filter.error').toLowerCase()}</span>
        <span className="harvest-muted" style={{ fontSize: '0.85rem', alignSelf: 'center' }}>
          {t('harvest.datasetsCount', { count: summary.total })}
        </span>
      </div>

      {nIncremental > 0 && (
        <div className="harvest-summary">
          <span
            className="harvest-count-pill harvest-count-files"
            title={t('harvest.mode.incremental.tip')}
          >
            📁 {t('harvest.server.incrementalCount', { count: nIncremental })}
          </span>
        </div>
      )}

      {reasons && reasons.length > 0 && (
        <details style={{ marginBottom: '1rem' }}>
          <summary style={{ cursor: 'pointer', fontSize: '0.88rem', color: '#5a7a7f' }}>
            {t('harvest.topFailureReasons')} ({reasons.length})
          </summary>
          <table className="harvest-table" style={{ maxWidth: 400, marginTop: '0.5rem' }}>
            <tbody>
              {reasons.map(r => (
                <tr key={r.reason_code}>
                  <td title={r.reason_code}>{reasonLabel(t, r.reason_code)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{r.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      <div className="harvest-filter-bar">
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); applyFilters(e.target.value, q) }}
        >
          <option value="">{t('harvest.filter.allStatuses')}</option>
          <option value="success">{t('harvest.filter.success')}</option>
          <option value="skipped">{t('harvest.filter.skipped')}</option>
          <option value="error">{t('harvest.filter.error')}</option>
        </select>
        <input
          type="text"
          placeholder={t('harvest.filter.searchPlaceholder')}
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
            onClick={() => { setStatusFilter(''); setQ(''); setSearchParams({}) }}
            style={{ padding: '0.35rem 0.8rem', fontSize: '0.85rem', cursor: 'pointer', color: '#7a8e91' }}
          >
            {t('harvest.filter.clear')}
          </button>
        )}
      </div>

      {loading
        ? <div className="harvest-loading">{t('harvest.loading.datasets')}</div>
        : <table className="harvest-table">
            <thead>
              <tr>
                <th>{t('harvest.col.status')}</th>
                <th>{t('harvest.col.datasetId')}</th>
                <th>{t('harvest.col.hashable')}</th>
                <th>{t('harvest.col.recent')}</th>
                <th>{t('harvest.col.reason')}</th>
                <th>{t('harvest.col.lastUpdate')}</th>
                <th>{t('harvest.col.lastCheck')}</th>
                <th>{t('harvest.col.duration')}</th>
              </tr>
            </thead>
            <tbody>
              {(datasets || []).map(d => {
                const datasetSlug = slugify(d.erddap_url)
                return (
                  <tr key={d.dataset_id}>
                    <td><StatusBadge status={d.status} /></td>
                    <td>
                      <Link
                        to={`/harvest/dataset/${datasetSlug}/${encodeURIComponent(d.dataset_id)}`}
                        className="harvest-link harvest-mono"
                        style={{ fontSize: '0.82rem' }}
                      >
                        {d.dataset_id}
                      </Link>
                      {' '}
                      <a
                        href={datasetLink(d.erddap_url, d.dataset_id, d.source)}
                        target="_blank"
                        rel="noreferrer"
                        className="harvest-muted"
                        style={{ fontSize: '0.72rem' }}
                        title={t('harvest.server.viewOnSource')}
                      >
                        ↗
                      </a>
                    </td>
                    <td><HarvestModeBadge dataset={d} /></td>
                    <td><Sparkline statuses={d.history_statuses} /></td>
                    <td>
                      {d.reason_code
                        ? <span title={d.reason_code} style={{ fontSize: '0.8rem' }}>{reasonLabel(t, d.reason_code)}</span>
                        : <span className="harvest-muted">—</span>
                      }
                    </td>
                    <td className="harvest-muted" style={{ fontSize: '0.82rem' }}>{fmtDt(d.last_updated_at)}</td>
                    <td className="harvest-muted" style={{ fontSize: '0.82rem' }}>{fmtDt(d.attempted_at)}</td>
                    <td className="harvest-muted" style={{ fontSize: '0.82rem' }}>{fmtDurationMs(d.duration_ms)}</td>
                  </tr>
                )
              })}
              {!loading && (!datasets || datasets.length === 0) && (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', padding: '1.5rem', color: '#8a9ea2' }}>
                    {t('harvest.server.noDatasets')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
      }
    </HarvestLayout>
  )
}
