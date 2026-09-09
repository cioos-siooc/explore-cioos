import React from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import HarvestLayout from './HarvestLayout.jsx'
import useHarvestFetch from './useHarvestFetch.js'
import { datasetBadgeClass, jobBadgeClass, datasetReason } from './downloadStatus.js'
import { hostname, fmtDt, fmtDurationS, fmtBytes, datasetLink } from './format.js'

export default function HarvestDownloadJob() {
  const { t } = useTranslation()
  const { jobId } = useParams()
  const { data, loading, error } = useHarvestFetch(`/downloads/${jobId}`, [jobId])

  const breadcrumbs = (
    <>
      <Link to="/harvest" className="harvest-link">{t('harvest.title')}</Link>
      {' / '}
      <Link to="/harvest/downloads" className="harvest-link">{t('harvest.downloads.title')}</Link>
    </>
  )

  if (loading) {
    return (
      <HarvestLayout breadcrumbs={breadcrumbs}>
        <div className="harvest-loading">{t('harvest.loading')}</div>
      </HarvestLayout>
    )
  }

  if (error || !data) {
    return (
      <HarvestLayout breadcrumbs={breadcrumbs}>
        <div className="harvest-muted">{t('harvest.downloads.jobNotFound')}</div>
      </HarvestLayout>
    )
  }

  const { job, datasets } = data

  return (
    <HarvestLayout breadcrumbs={breadcrumbs}>
      <h1 className="harvest-page-title">
        {t('harvest.downloads.jobTitle', { jobId: job.job_id })}
      </h1>

      <table className="harvest-table" style={{ maxWidth: 520, marginBottom: '1.5rem' }}>
        <tbody>
          <tr>
            <td>{t('harvest.col.status')}</td>
            <td>
              <span className={`harvest-status harvest-status-${jobBadgeClass(job.status)}`}>
                {job.status}
              </span>
            </td>
          </tr>
          <tr>
            <td>{t('harvest.col.when')}</td>
            <td>{fmtDt(job.time)}</td>
          </tr>
          <tr>
            <td>{t('harvest.col.started')}</td>
            <td>{fmtDt(job.time_start)}</td>
          </tr>
          <tr>
            <td>{t('harvest.col.finished')}</td>
            <td>{fmtDt(job.time_complete)}</td>
          </tr>
          <tr>
            <td>{t('harvest.col.duration')}</td>
            <td>{fmtDurationS(job.duration_s)}</td>
          </tr>
          <tr>
            <td>{t('harvest.downloads.col.size')}</td>
            <td>
              {fmtBytes(job.download_size)}
              {job.estimate_size != null && (
                <span className="harvest-muted" style={{ fontSize: '0.8rem' }}>
                  {' '}({t('harvest.downloads.estimated', { size: fmtBytes(job.estimate_size) })})
                </span>
              )}
            </td>
          </tr>
        </tbody>
      </table>

      {job.error_message && (
        <>
          <h2 className="harvest-section-title">{t('harvest.downloads.jobError')}</h2>
          <pre className="harvest-mono harvest-error-block">{job.error_message}</pre>
        </>
      )}

      <h2 className="harvest-section-title">{t('harvest.downloads.datasetsTitle')}</h2>
      {datasets.length === 0
        ? <div className="harvest-muted">{t('harvest.downloads.noDatasetDetail')}</div>
        : <table className="harvest-table">
            <thead>
              <tr>
                <th>{t('harvest.col.datasetId')}</th>
                <th>{t('harvest.col.server')}</th>
                <th>{t('harvest.col.status')}</th>
                <th style={{ textAlign: 'right' }}>{t('harvest.downloads.col.size')}</th>
                <th>{t('harvest.col.reason')}</th>
              </tr>
            </thead>
            <tbody>
              {datasets.map(d => {
                const isObis = (d.erddap_url || '').includes('obis.org')
                const reason = datasetReason(t, d)
                return (
                  <tr key={`${d.erddap_url}|${d.dataset_id}`}>
                    <td>
                      <a
                        href={datasetLink(d.erddap_url, d.dataset_id, isObis ? 'obis' : 'erddap')}
                        target="_blank"
                        rel="noreferrer"
                        className="harvest-link"
                      >
                        {d.dataset_id}
                      </a>
                    </td>
                    <td className="harvest-muted" style={{ fontSize: '0.82rem' }} title={d.erddap_url}>
                      {isObis ? 'OBIS' : hostname(d.erddap_url)}
                    </td>
                    <td>
                      <span className={`harvest-status harvest-status-${datasetBadgeClass(d.status)}`}>
                        {d.status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>{fmtBytes(d.file_size)}</td>
                    <td
                      className="harvest-muted"
                      style={{ fontSize: '0.78rem', color: reason ? '#7a1520' : undefined }}
                      title={reason || ''}
                    >
                      {reason ? `${reason.slice(0, 140)}${reason.length > 140 ? '…' : ''}` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
      }
    </HarvestLayout>
  )
}
