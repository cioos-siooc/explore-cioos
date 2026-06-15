import React from 'react'
import { useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import HarvestLayout from './HarvestLayout.jsx'
import StatusBadge from './StatusBadge.jsx'
import useHarvestFetch from './useHarvestFetch.js'
import reasonLabel from './reasonLabel.js'
import { slugify } from './slug.js'
import { hostname, fmtDt, fmtDurationS, fmtDurationMs, displayStatus } from './format.js'

export default function HarvestRun() {
  const { t } = useTranslation()
  const { runId } = useParams()
  const { data, loading, error } = useHarvestFetch(`/runs/${runId}`, [runId])

  const run = data?.run
  const attempts = data?.attempts || []

  const summary = attempts.reduce(
    (acc, a) => { acc[displayStatus(a)] = (acc[displayStatus(a)] || 0) + 1; acc.total++; return acc },
    { success: 0, unchanged: 0, skipped: 0, error: 0, total: 0 }
  )

  const breadcrumbs = (
    <><Link to="/harvest">{t('harvest.title')}</Link> / {t('harvest.run.title')} {runId.slice(0, 8)}…</>
  )

  if (loading) return <HarvestLayout breadcrumbs={breadcrumbs}><div className="harvest-loading">{t('harvest.loading')}</div></HarvestLayout>
  if (error)   return <HarvestLayout breadcrumbs={breadcrumbs}><div className="harvest-fetch-error">{error}</div></HarvestLayout>
  if (!run)    return <HarvestLayout breadcrumbs={breadcrumbs}><div className="harvest-fetch-error">{t('harvest.run.notFound')}</div></HarvestLayout>

  return (
    <HarvestLayout breadcrumbs={breadcrumbs}>
      <h1 className="harvest-page-title">
        {t('harvest.run.title')} <StatusBadge status={run.status} />
      </h1>
      <p className="harvest-page-sub harvest-mono" style={{ fontSize: '0.78rem' }}>{run.run_id}</p>

      <div className="harvest-run-meta">
        <div className="harvest-run-meta-item">
          <span className="harvest-run-meta-label">{t('harvest.col.started')}</span>
          <span className="harvest-run-meta-value">{fmtDt(run.started_at)}</span>
        </div>
        <div className="harvest-run-meta-item">
          <span className="harvest-run-meta-label">{t('harvest.col.finished')}</span>
          <span className="harvest-run-meta-value">{fmtDt(run.finished_at)}</span>
        </div>
        <div className="harvest-run-meta-item">
          <span className="harvest-run-meta-label">{t('harvest.col.duration')}</span>
          <span className="harvest-run-meta-value">{fmtDurationS(run.duration_s)}</span>
        </div>
        {run.git_sha && (
          <div className="harvest-run-meta-item">
            <span className="harvest-run-meta-label">{t('harvest.col.gitSha')}</span>
            <span className="harvest-run-meta-value harvest-mono">{run.git_sha.slice(0, 7)}</span>
          </div>
        )}
        {run.scope && (
          <div className="harvest-run-meta-item">
            <span className="harvest-run-meta-label">{t('harvest.col.scope')}</span>
            <span className="harvest-run-meta-value">{run.scope}</span>
          </div>
        )}
        {run.triggered_by && (
          <div className="harvest-run-meta-item">
            <span className="harvest-run-meta-label">{t('harvest.col.triggeredBy')}</span>
            <span className="harvest-run-meta-value">{run.triggered_by}</span>
          </div>
        )}
      </div>

      {run.error_message && (
        <div className="harvest-error-box">{run.error_message}</div>
      )}

      <div className="harvest-summary" style={{ marginBottom: '1rem' }}>
        <span className="harvest-count-pill harvest-count-success">✓ {summary.success}</span>
        <span className="harvest-count-pill harvest-count-unchanged" title={t('harvest.reason.UNCHANGED')}>↻ {summary.unchanged}</span>
        <span className="harvest-count-pill harvest-count-skipped">· {summary.skipped}</span>
        <span className="harvest-count-pill harvest-count-error">✗ {summary.error}</span>
        <span className="harvest-muted" style={{ fontSize: '0.85rem', alignSelf: 'center' }}>
          {t('harvest.datasetsCount', { count: summary.total })}
        </span>
      </div>

      <table className="harvest-table">
        <thead>
          <tr>
            <th>{t('harvest.col.server')}</th>
            <th>{t('harvest.col.datasetId')}</th>
            <th>{t('harvest.col.status')}</th>
            <th>{t('harvest.col.reason')}</th>
            <th>{t('harvest.col.duration')}</th>
          </tr>
        </thead>
        <tbody>
          {attempts.map((a, i) => {
            const serverSlug = slugify(a.erddap_url)
            return (
              <tr key={`${a.erddap_url}-${a.dataset_id}-${i}`}>
                <td style={{ fontSize: '0.82rem' }}>
                  <Link to={`/harvest/server/${serverSlug}`} className="harvest-link">
                    {hostname(a.erddap_url)}
                  </Link>
                </td>
                <td>
                  <Link
                    to={`/harvest/dataset/${serverSlug}/${encodeURIComponent(a.dataset_id)}`}
                    className="harvest-link harvest-mono"
                    style={{ fontSize: '0.8rem' }}
                  >
                    {a.dataset_id}
                  </Link>
                </td>
                <td><StatusBadge status={displayStatus(a)} /></td>
                <td>
                  {a.reason_code && a.reason_code !== 'UNCHANGED' && (
                    <span title={a.reason_code} style={{ fontSize: '0.8rem' }}>{reasonLabel(t, a.reason_code)}</span>
                  )}
                  {a.error_message && (
                    <details style={{ marginTop: '0.2rem' }}>
                      <summary style={{ cursor: 'pointer', fontSize: '0.75rem', color: '#7a1520' }}>
                        {t('harvest.run.detail')}
                      </summary>
                      <div style={{ fontSize: '0.78rem', wordBreak: 'break-word', marginTop: '0.2rem' }}>
                        {a.error_message}
                      </div>
                    </details>
                  )}
                </td>
                <td style={{ fontSize: '0.82rem' }}>{fmtDurationMs(a.duration_ms)}</td>
              </tr>
            )
          })}
          {!attempts.length && (
            <tr>
              <td colSpan="5" style={{ textAlign: 'center', padding: '1.5rem', color: '#8a9ea2' }}>
                {t('harvest.run.noAttempts')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </HarvestLayout>
  )
}
