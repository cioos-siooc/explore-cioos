import React from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import HarvestLayout from "./HarvestLayout.jsx";
import StatusBadge from "./StatusBadge.jsx";
import useHarvestFetch from "./useHarvestFetch.js";
import reasonLabel from "./reasonLabel.js";
import { slugify } from "./slug.js";
import { hostname, fmtDt, fmtDurationS } from "./format.js";

function runLabel(r) {
  if (r.triggered_source) {
    try {
      return new URL(r.triggered_source).hostname;
    } catch {
      return r.triggered_source;
    }
  }
  return r.scope || "—";
}

function ServerCard({ server, t }) {
  const slug = slugify(server.erddap_url);
  return (
    <Link to={`/harvest/server/${slug}`} className="harvest-card">
      <div className="harvest-card-hostname">{hostname(server.erddap_url)}</div>
      <div className="harvest-card-url">{server.erddap_url}</div>
      <div className="harvest-card-counts">
        <span className="harvest-count-pill harvest-count-success">
          ✓ {server.n_success}
        </span>
        <span className="harvest-count-pill harvest-count-skipped">
          · {server.n_skipped}
        </span>
        <span className="harvest-count-pill harvest-count-error">
          ✗ {server.n_error}
        </span>
      </div>
      <div className="harvest-card-meta">
        {t("harvest.card.lastAttempt", {
          date: fmtDt(server.last_attempted_at),
        })}
      </div>
    </Link>
  );
}

export default function HarvestOverview() {
  const { t } = useTranslation();
  const { data: servers, loading: loadingServers } = useHarvestFetch(
    "/servers",
    [],
  );
  const { data: runs, loading: loadingRuns } = useHarvestFetch(
    "/runs/recent",
    [],
  );
  const { data: reasons, loading: loadingReasons } = useHarvestFetch(
    "/reasons",
    [],
  );
  const { data: downloads } = useHarvestFetch("/downloads/summary", []);

  const stuckDownloads = downloads
    ? Number(downloads.n_stuck || 0) + Number(downloads.n_stalled || 0)
    : 0;

  return (
    <HarvestLayout>
      <h1 className="harvest-page-title">{t("harvest.title")}</h1>
      <p className="harvest-page-sub">
        {servers
          ? t("harvest.overview.subtitle", { count: servers.length })
          : ""}
      </p>

      {loadingServers ? (
        <div className="harvest-loading">{t("harvest.loading.sources")}</div>
      ) : (
        <div className="harvest-card-grid">
          {(servers || []).map((s) => (
            <ServerCard key={s.erddap_url} server={s} t={t} />
          ))}
        </div>
      )}

      {stuckDownloads > 0 && (
        <div className="harvest-queue-warning">
          <Link to="/harvest/downloads" className="harvest-link">
            {t("harvest.downloads.queueStalled", { count: stuckDownloads })}
          </Link>
        </div>
      )}

      <h2 className="harvest-section-title">
        {t("harvest.downloads.title")}
        <Link
          to="/harvest/downloads"
          className="harvest-link harvest-section-link"
        >
          {t("harvest.downloads.viewAll")}
        </Link>
      </h2>
      {downloads && (
        <div className="harvest-card-counts">
          <span className="harvest-count-pill harvest-count-success">
            ✓ {downloads.n_completed} {t("harvest.downloads.completed")}
          </span>
          <span className="harvest-count-pill harvest-count-error">
            ✗ {downloads.n_failed} {t("harvest.downloads.failed")}
          </span>
          <span className="harvest-count-pill harvest-count-unchanged">
            {downloads.n_open} {t("harvest.downloads.queued")}
          </span>
          <span className="harvest-muted harvest-text-sm harvest-self-center">
            {t("harvest.downloads.lastRequest", {
              date: fmtDt(downloads.last_request_at),
            })}
          </span>
        </div>
      )}

      <h2 className="harvest-section-title">{t("harvest.recentRuns")}</h2>
      {loadingRuns ? (
        <div className="harvest-loading">{t("harvest.loading.runs")}</div>
      ) : (
        <table className="harvest-table">
          <thead>
            <tr>
              <th>{t("harvest.col.started")}</th>
              <th>{t("harvest.col.scope")}</th>
              <th>{t("harvest.col.status")}</th>
              <th>{t("harvest.col.duration")}</th>
              <th>{t("harvest.col.gitSha")}</th>
              <th className="harvest-num">{t("harvest.col.ok")}</th>
              <th className="harvest-num">{t("harvest.col.unchanged")}</th>
              <th className="harvest-num">{t("harvest.col.skipped")}</th>
              <th className="harvest-num">{t("harvest.col.error")}</th>
              <th className="harvest-num">{t("harvest.col.total")}</th>
            </tr>
          </thead>
          <tbody>
            {(runs || []).map((r) => (
              <tr key={r.run_id}>
                <td className="harvest-text-sm">
                  <Link
                    to={`/harvest/run/${r.run_id}`}
                    className="harvest-link"
                  >
                    {fmtDt(r.started_at)}
                  </Link>
                </td>
                <td className="harvest-text-sm">
                  <span title={r.triggered_source || r.scope}>
                    {runLabel(r)}
                  </span>
                  {r.triggered_by && (
                    <div className="harvest-muted harvest-text-xs">
                      {r.triggered_by}
                    </div>
                  )}
                  {r.error_message && (
                    <div
                      className="harvest-text-xs harvest-error-text"
                      style={{ marginTop: "2px" }}
                    >
                      {r.error_message.slice(0, 80)}
                      {r.error_message.length > 80 ? "…" : ""}
                    </div>
                  )}
                </td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td className="harvest-muted harvest-text-sm">
                  {fmtDurationS(r.duration_s)}
                </td>
                <td className="harvest-mono harvest-muted harvest-text-sm">
                  {r.git_sha ? r.git_sha.slice(0, 7) : "—"}
                </td>
                <td className="harvest-num">{r.n_success}</td>
                <td className="harvest-muted harvest-num">{r.n_unchanged}</td>
                <td className="harvest-num">{r.n_skipped}</td>
                <td
                  className={`harvest-num ${r.n_error > 0 ? "harvest-error-text" : ""}`}
                >
                  {r.n_error}
                </td>
                <td className="harvest-num-total">{r.n_total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!loadingReasons && reasons && reasons.length > 0 && (
        <>
          <h2 className="harvest-section-title">
            {t("harvest.topFailureReasons")}
          </h2>
          <table className="harvest-table" style={{ maxWidth: 500 }}>
            <thead>
              <tr>
                <th>{t("harvest.col.reasonCode")}</th>
                <th className="harvest-num">{t("harvest.col.datasets")}</th>
              </tr>
            </thead>
            <tbody>
              {reasons.map((r) => (
                <tr key={r.reason_code}>
                  <td title={r.reason_code}>{reasonLabel(t, r.reason_code)}</td>
                  <td className="harvest-num-total">{r.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </HarvestLayout>
  );
}
