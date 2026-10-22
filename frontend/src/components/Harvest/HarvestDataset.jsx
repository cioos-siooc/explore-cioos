import React from "react";
import { useParams, Link } from "react-router";
import { useTranslation } from "react-i18next";
import HarvestLayout from "./HarvestLayout.jsx";
import { HarvestTableSkeleton } from "./HarvestSkeleton.jsx";
import StatusBadge from "./StatusBadge.jsx";
import HarvestModeBadge from "./HarvestModeBadge.jsx";
import HarvestRealtimeBadge from "./HarvestRealtimeBadge.jsx";
import useHarvestFetch from "./useHarvestFetch.js";
import reasonLabel from "./reasonLabel.js";
import warningLabel from "./warningLabel.js";
import { hostname, fmtDt, fmtDurationMs, datasetLink } from "./format.js";

function QueryUrls({ blob, isError }) {
  if (!blob) return null;
  const urls = blob.split("\n").filter(Boolean);
  if (!urls.length) return null;
  return (
    <ul className="harvest-query-urls">
      {urls.map((url, i) => {
        const isFailed = isError && i === urls.length - 1;
        return (
          <li key={i}>
            <span className={isFailed ? "harvest-url-fail" : "harvest-url-ok"}>
              {isFailed ? "✗" : "✓"}
            </span>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="harvest-link harvest-text-sm"
            >
              {url}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function WarningList({ warnings }) {
  const { t } = useTranslation();
  return (
    <div className="harvest-warning-box">
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {warnings.map((w, i) => (
          <li key={`${w.code}-${i}`}>
            ⚠ <strong title={w.code}>{warningLabel(t, w.code)}</strong>
            {w.count != null && ` (${w.count})`}: {w.message}
            {w.items?.length > 0 && (
              <details>
                <summary className="harvest-clickable harvest-text-sm">
                  {t("harvest.warnings.items", { count: w.items.length })}
                </summary>
                <ul className="harvest-mono harvest-text-sm">
                  {w.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function HarvestDataset() {
  const { t } = useTranslation();
  const { slug, datasetId } = useParams();

  const { data, loading, error } = useHarvestFetch(
    `/dataset/${slug}/${encodeURIComponent(datasetId)}`,
  );

  const history = (data && data.history) || [];
  const meta = data && data.meta;
  const currentWarnings = data?.currentWarnings || [];
  const latest = history[0];
  // The slug is a transformed source URL; the full erddap_url (and a clean
  // hostname for display) come from the API response.
  const erddapUrl = (data && data.erddap_url) || "";
  const host = hostname(erddapUrl) || slug;
  const sourceUrl = latest
    ? datasetLink(erddapUrl, datasetId, latest.source)
    : "#";
  const viewOnLabel =
    latest?.source === "obis"
      ? t("harvest.dataset.viewOnObis")
      : t("harvest.dataset.viewOnErddap");

  const breadcrumbs = (
    <>
      <Link to="/harvest">{t("harvest.title")}</Link>
      {" / "}
      <Link to={`/harvest/server/${slug}`}>{host}</Link>
      {" / "}
      <span className="harvest-mono">{datasetId}</span>
    </>
  );

  if (loading)
    return (
      <HarvestLayout breadcrumbs={breadcrumbs}>
        <HarvestTableSkeleton label={t("harvest.loading")} />
      </HarvestLayout>
    );
  if (error)
    return (
      <HarvestLayout breadcrumbs={breadcrumbs}>
        <div className="harvest-fetch-error">{error}</div>
      </HarvestLayout>
    );

  return (
    <HarvestLayout breadcrumbs={breadcrumbs}>
      <h1 className="harvest-page-title harvest-mono harvest-text-lg">
        {datasetId}
      </h1>
      <p className="harvest-page-sub">
        <Link to={`/harvest/server/${slug}`} className="harvest-link">
          {host}
        </Link>
        {" · "}
        <a
          href={sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="harvest-link"
        >
          {viewOnLabel}
        </a>
      </p>

      {latest && (
        <div className="harvest-latest-card">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              marginBottom: "0.5rem",
            }}
          >
            <StatusBadge status={latest.status} />
            {meta && <HarvestModeBadge dataset={meta} />}
            {meta && <HarvestRealtimeBadge isRealtime={meta.is_realtime} />}
            {latest.reason_code && (
              <span className="harvest-text-md" title={latest.reason_code}>
                {reasonLabel(t, latest.reason_code)}
              </span>
            )}
            <span className="harvest-muted harvest-text-sm">
              {t("harvest.col.lastCheck")}: {fmtDt(latest.attempted_at)}
            </span>
          </div>
          {meta &&
            (meta.content_hash ||
              meta.content_hash_reason ||
              meta.last_updated_at) && (
              <div
                className="harvest-muted harvest-text-sm"
                style={{
                  marginBottom: "0.5rem",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "1.25rem",
                }}
              >
                {meta.last_updated_at && (
                  <span>
                    {t("harvest.col.lastUpdate")}: {fmtDt(meta.last_updated_at)}
                  </span>
                )}
                {meta.content_hash && (
                  <span title={meta.content_hash}>
                    {t("harvest.col.contentHash")}:{" "}
                    <span className="harvest-mono">
                      {meta.content_hash.slice(0, 16)}…
                    </span>
                  </span>
                )}
                {!meta.content_hash && meta.content_hash_reason && (
                  <span title={meta.content_hash_reason}>
                    {t("harvest.col.contentHash")}:{" "}
                    {t(
                      `harvest.hashReason.${meta.content_hash_reason}`,
                      meta.content_hash_reason,
                    )}
                  </span>
                )}
              </div>
            )}
          {latest.error_message && (
            <div className="harvest-error-box">{latest.error_message}</div>
          )}
          {currentWarnings.length > 0 && (
            <WarningList warnings={currentWarnings} />
          )}
          {latest.query_urls && (
            <details open={latest.status === "error"}>
              <summary className="harvest-clickable harvest-text-sm harvest-muted-strong">
                {t("harvest.dataset.requestUrls", {
                  count: latest.query_urls.split("\n").filter(Boolean).length,
                })}
              </summary>
              <QueryUrls
                blob={latest.query_urls}
                isError={latest.status === "error"}
              />
            </details>
          )}
        </div>
      )}

      <h2 className="harvest-section-title">
        {t("harvest.dataset.historyTitle")}
      </h2>
      {/* The attempt table is append-only and unpaginated, so the API caps it.
          Say so rather than letting a capped list read as the whole history. */}
      {data?.historyTruncated && (
        <p className="harvest-text-sm">
          {t("harvest.dataset.historyTruncated", { count: history.length })}
        </p>
      )}
      <table className="harvest-table">
        <thead>
          <tr>
            <th>{t("harvest.col.when")}</th>
            <th>{t("harvest.col.status")}</th>
            <th>{t("harvest.col.reason")}</th>
            <th>{t("harvest.col.duration")}</th>
            <th>{t("harvest.col.run")}</th>
          </tr>
        </thead>
        <tbody>
          {(history || []).map((row, i) => (
            <tr key={`${row.run_id}-${i}`}>
              <td className="harvest-text-sm">{fmtDt(row.attempted_at)}</td>
              <td>
                <StatusBadge status={row.status} />
              </td>
              <td>
                {row.reason_code && (
                  <span className="harvest-text-sm" title={row.reason_code}>
                    {reasonLabel(t, row.reason_code)}
                  </span>
                )}
                {row.warnings?.length > 0 && (
                  <span
                    className="harvest-warning-text"
                    title={[
                      t("harvest.warnings.count", {
                        count: row.warnings.length,
                      }),
                      ...row.warnings.map((w) => w.message),
                    ].join("\n")}
                  >
                    ⚠ {row.warnings.length}
                  </span>
                )}
                {row.error_message && (
                  <details style={{ marginTop: "0.25rem" }}>
                    <summary className="harvest-clickable harvest-text-xs harvest-error-text">
                      {t("harvest.dataset.errorDetail")}
                    </summary>
                    <div
                      className="harvest-text-sm harvest-wrap"
                      style={{ marginTop: "0.25rem" }}
                    >
                      {row.error_message}
                    </div>
                    {row.query_urls && (
                      <QueryUrls
                        blob={row.query_urls}
                        isError={row.status === "error"}
                      />
                    )}
                  </details>
                )}
              </td>
              <td className="harvest-text-sm">
                {fmtDurationMs(row.duration_ms)}
              </td>
              <td>
                <Link
                  to={`/harvest/run/${row.run_id}`}
                  className="harvest-link harvest-mono harvest-text-sm"
                >
                  {row.git_sha
                    ? row.git_sha.slice(0, 7)
                    : row.run_id.slice(0, 8)}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </HarvestLayout>
  );
}
