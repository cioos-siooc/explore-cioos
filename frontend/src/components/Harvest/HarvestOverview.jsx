import React from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import HarvestLayout from './HarvestLayout.jsx'
import StatusBadge from './StatusBadge.jsx'
import useHarvestFetch from './useHarvestFetch.js'
import { slugify } from './slug.js'

function hostname(url) {
  try { return new URL(url).hostname || url } catch { return url }
}

function fmtDt(val) {
  if (!val) return '—'
  return new Date(val).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

function ServerCard({ server, t }) {
  const slug = slugify(server.erddap_url)
  return (
    <Link to={`/harvest/server/${slug}`} className="harvest-card">
      <div className="harvest-card-hostname">{hostname(server.erddap_url)}</div>
      <div className="harvest-card-url">{server.erddap_url}</div>
      <div className="harvest-card-counts">
        <span className="harvest-count-pill harvest-count-success">✓ {server.n_success}</span>
        <span className="harvest-count-pill harvest-count-skipped">· {server.n_skipped}</span>
        <span className="harvest-count-pill harvest-count-error">✗ {server.n_error}</span>
      </div>
      <div className="harvest-card-meta">{t('harvest.card.lastAttempt', { date: fmtDt(server.last_attempted_at) })}</div>
    </Link>
  )
}

export default function HarvestOverview() {
  const { t } = useTranslation()
  const { data: servers, loading: loadingServers } = useHarvestFetch('/servers', [])
  const { data: runs,    loading: loadingRuns }    = useHarvestFetch('/runs/recent', [])
  const { data: reasons, loading: loadingReasons } = useHarvestFetch('/reasons', [])

  return (
    <HarvestLayout>
      <h1 className="harvest-page-title">{t('harvest.title')}</h1>
      <p className="harvest-page-sub">
        {servers ? t('harvest.overview.subtitle', { count: servers.length }) : ''}
      </p>

      {loadingServers
        ? <div className="harvest-loading">{t('harvest.loading.sources')}</div>
        : <div className="harvest-card-grid">
            {(servers || []).map(s => <ServerCard key={s.erddap_url} server={s} t={t} />)}
          </div>
      }

      <h2 className="harvest-section-title">{t('harvest.recentRuns')}</h2>
      {loadingRuns
        ? <div className="harvest-loading">{t('harvest.loading.runs')}</div>
        : <table className="harvest-table">
            <thead>
              <tr>
                <th>{t('harvest.col.started')}</th>
                <th>{t('harvest.col.status')}</th>
                <th>{t('harvest.col.gitSha')}</th>
                <th style={{ textAlign: 'right' }}>{t('harvest.col.ok')}</th>
                <th style={{ textAlign: 'right' }}>{t('harvest.col.skipped')}</th>
                <th style={{ textAlign: 'right' }}>{t('harvest.col.error')}</th>
                <th style={{ textAlign: 'right' }}>{t('harvest.col.total')}</th>
              </tr>
            </thead>
            <tbody>
              {(runs || []).map(r => (
                <tr key={r.run_id}>
                  <td>
                    <Link to={`/harvest/run/${r.run_id}`} className="harvest-link">
                      {fmtDt(r.started_at)}
                    </Link>
                  </td>
                  <td><StatusBadge status={r.status} /></td>
                  <td className="harvest-mono harvest-muted">{r.git_sha ? r.git_sha.slice(0, 7) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{r.n_success}</td>
                  <td style={{ textAlign: 'right' }}>{r.n_skipped}</td>
                  <td style={{ textAlign: 'right', color: r.n_error > 0 ? '#7a1520' : undefined }}>{r.n_error}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{r.n_total}</td>
                </tr>
              ))}
            </tbody>
          </table>
      }

      {!loadingReasons && reasons && reasons.length > 0 && (
        <>
          <h2 className="harvest-section-title">{t('harvest.topFailureReasons')}</h2>
          <table className="harvest-table" style={{ maxWidth: 500 }}>
            <thead>
              <tr>
                <th>{t('harvest.col.reasonCode')}</th>
                <th style={{ textAlign: 'right' }}>{t('harvest.col.datasets')}</th>
              </tr>
            </thead>
            <tbody>
              {reasons.map(r => (
                <tr key={r.reason_code}>
                  <td className="harvest-mono">{r.reason_code}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{r.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </HarvestLayout>
  )
}
