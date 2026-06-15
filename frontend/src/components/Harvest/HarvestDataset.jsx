import React from 'react'
import { useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import HarvestLayout from './HarvestLayout.jsx'
import StatusBadge from './StatusBadge.jsx'
import HarvestModeBadge from './HarvestModeBadge.jsx'
import useHarvestFetch from './useHarvestFetch.js'
import reasonLabel from './reasonLabel.js'
import { unslug, slugify } from './slug.js'
import { hostname, fmtDt, fmtDurationMs, datasetLink } from './format.js'

function QueryUrls({ blob, isError }) {
  if (!blob) return null
  const urls = blob.split('\n').filter(Boolean)
  if (!urls.length) return null
  return (
    <ul className="harvest-query-urls">
      {urls.map((url, i) => {
        const isFailed = isError && i === urls.length - 1
        return (
          <li key={i}>
            <span className={isFailed ? 'harvest-url-fail' : 'harvest-url-ok'}>
              {isFailed ? '✗' : '✓'}
            </span>
            <a href={url} target="_blank" rel="noreferrer" className="harvest-link" style={{ fontSize: '0.78rem' }}>
              {url}
            </a>
          </li>
        )
      })}
    </ul>
  )
}

export default function HarvestDataset() {
  const { t } = useTranslation()
  const { slug, datasetId } = useParams()
  const erddapUrl = unslug(slug)
  const host = hostname(erddapUrl)

  const { data, loading, error } = useHarvestFetch(
    `/dataset/${slug}/${encodeURIComponent(datasetId)}`,
    [slug, datasetId]
  )

  const history = (data && data.history) || []
  const meta = data && data.meta
  const latest = history[0]
  const sourceUrl = latest ? datasetLink(erddapUrl, datasetId, latest.source) : '#'
  const viewOnLabel = latest?.source === 'obis'
    ? t('harvest.dataset.viewOnObis')
    : t('harvest.dataset.viewOnErddap')

  const breadcrumbs = (
    <>
      <Link to="/harvest">{t('harvest.title')}</Link>
      {' / '}
      <Link to={`/harvest/server/${slug}`}>{host}</Link>
      {' / '}
      <span className="harvest-mono">{datasetId}</span>
    </>
  )

  if (loading) return <HarvestLayout breadcrumbs={breadcrumbs}><div className="harvest-loading">{t('harvest.loading')}</div></HarvestLayout>
  if (error)   return <HarvestLayout breadcrumbs={breadcrumbs}><div className="harvest-fetch-error">{error}</div></HarvestLayout>

  return (
    <HarvestLayout breadcrumbs={breadcrumbs}>
      <h1 className="harvest-page-title harvest-mono" style={{ fontSize: '1.2rem' }}>{datasetId}</h1>
      <p className="harvest-page-sub">
        <Link to={`/harvest/server/${slug}`} className="harvest-link">{host}</Link>
        {' · '}
        <a href={sourceUrl} target="_blank" rel="noreferrer" className="harvest-link">
          {viewOnLabel}
        </a>
      </p>

      {latest && (
        <div className="harvest-latest-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <StatusBadge status={latest.status} />
            {meta && <HarvestModeBadge dataset={meta} />}
            {latest.reason_code && (
              <span title={latest.reason_code} style={{ fontSize: '0.85rem' }}>{reasonLabel(t, latest.reason_code)}</span>
            )}
            <span className="harvest-muted" style={{ fontSize: '0.82rem' }}>
              {t('harvest.col.lastCheck')}: {fmtDt(latest.attempted_at)}
            </span>
          </div>
          {meta && (meta.content_hash || meta.content_hash_reason || meta.last_updated_at) && (
            <div className="harvest-muted" style={{ fontSize: '0.8rem', marginBottom: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '1.25rem' }}>
              {meta.last_updated_at && <span>{t('harvest.col.lastUpdate')}: {fmtDt(meta.last_updated_at)}</span>}
              {meta.content_hash && (
                <span title={meta.content_hash}>
                  {t('harvest.col.contentHash')}: <span className="harvest-mono">{meta.content_hash.slice(0, 16)}…</span>
                </span>
              )}
              {!meta.content_hash && meta.content_hash_reason && (
                <span title={meta.content_hash_reason}>
                  {t('harvest.col.contentHash')}: {t(`harvest.hashReason.${meta.content_hash_reason}`, meta.content_hash_reason)}
                </span>
              )}
            </div>
          )}
          {latest.error_message && (
            <div className="harvest-error-box">{latest.error_message}</div>
          )}
          {latest.query_urls && (
            <details open={latest.status === 'error'}>
              <summary style={{ cursor: 'pointer', fontSize: '0.82rem', color: '#5a7a7f' }}>
                {t('harvest.dataset.requestUrls', { count: latest.query_urls.split('\n').filter(Boolean).length })}
              </summary>
              <QueryUrls blob={latest.query_urls} isError={latest.status === 'error'} />
            </details>
          )}
        </div>
      )}

      <h2 className="harvest-section-title">{t('harvest.dataset.historyTitle')}</h2>
      <table className="harvest-table">
        <thead>
          <tr>
            <th>{t('harvest.col.when')}</th>
            <th>{t('harvest.col.status')}</th>
            <th>{t('harvest.col.reason')}</th>
            <th>{t('harvest.col.duration')}</th>
            <th>{t('harvest.col.run')}</th>
          </tr>
        </thead>
        <tbody>
          {(history || []).map((row, i) => (
            <tr key={`${row.run_id}-${i}`}>
              <td style={{ fontSize: '0.82rem' }}>{fmtDt(row.attempted_at)}</td>
              <td><StatusBadge status={row.status} /></td>
              <td>
                {row.reason_code && (
                  <span title={row.reason_code} style={{ fontSize: '0.8rem' }}>{reasonLabel(t, row.reason_code)}</span>
                )}
                {row.error_message && (
                  <details style={{ marginTop: '0.25rem' }}>
                    <summary style={{ cursor: 'pointer', fontSize: '0.75rem', color: '#7a1520' }}>
                      {t('harvest.dataset.errorDetail')}
                    </summary>
                    <div style={{ fontSize: '0.78rem', marginTop: '0.25rem', wordBreak: 'break-word' }}>
                      {row.error_message}
                    </div>
                    {row.query_urls && (
                      <QueryUrls blob={row.query_urls} isError={row.status === 'error'} />
                    )}
                  </details>
                )}
              </td>
              <td style={{ fontSize: '0.82rem' }}>{fmtDurationMs(row.duration_ms)}</td>
              <td>
                <Link to={`/harvest/run/${row.run_id}`} className="harvest-link harvest-mono" style={{ fontSize: '0.78rem' }}>
                  {row.git_sha ? row.git_sha.slice(0, 7) : row.run_id.slice(0, 8)}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </HarvestLayout>
  )
}
