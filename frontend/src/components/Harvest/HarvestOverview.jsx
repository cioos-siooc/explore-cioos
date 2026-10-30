import React from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import HarvestLayout from "./HarvestLayout.jsx";
import {
  HarvestCardsSkeleton,
  HarvestTableSkeleton,
} from "./HarvestSkeleton.jsx";
import StatusBadge from "./StatusBadge.jsx";
import HarvestPie, {
  mergeFailures,
  reasonShades,
  serverFailures,
} from "./HarvestPie.jsx";
import HarvestReasonBars from "./HarvestReasonBars.jsx";
import useHarvestFetch from "./useHarvestFetch.js";
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

function ServerCard({ server, shades, t }) {
  const slug = slugify(server.erddap_url);
  return (
    <Link to={`/harvest/server/${slug}`} className="harvest-card">
      <div className="harvest-card-hostname">{hostname(server.erddap_url)}</div>
      <div className="harvest-card-url">{server.erddap_url}</div>
      <HarvestPie
        harvested={Number(server.n_success) || 0}
        failures={serverFailures(server)}
        shades={shades}
      />
      <div className="harvest-card-meta">
        {t("harvest.card.lastAttempt", {
          date: fmtDt(server.last_attempted_at),
        })}
      </div>
      <div className="harvest-card-meta">
        {server.last_success_at
          ? t("harvest.card.lastSuccess", {
              date: fmtDt(server.last_success_at),
            })
          : t("harvest.card.noSuccess")}
      </div>
    </Link>
  );
}

export default function HarvestOverview() {
  const { t } = useTranslation();
  const { data: servers, loading: loadingServers } =
    useHarvestFetch("/servers");
  const { data: runs, loading: loadingRuns } = useHarvestFetch("/runs/recent");

  const failureLists = (servers || []).map(serverFailures);
  const shades = reasonShades(failureLists);
  const allFailures = mergeFailures(failureLists);
  const allHarvested = (servers || []).reduce(
    (sum, s) => sum + (Number(s.n_success) || 0),
    0,
  );

  return (
    <HarvestLayout>
      <h1 className="harvest-page-title">{t("harvest.title")}</h1>
      <p className="harvest-page-sub">
        {servers
          ? t("harvest.overview.subtitle", { count: servers.length })
          : ""}
      </p>

      {servers && servers.length > 0 && (
        <section className="harvest-catalogue">
          <div>
            <h2 className="harvest-section-title">
              {t("harvest.catalogue.title")}
            </h2>
            <div className="harvest-pie-detail">
              <HarvestPie
                harvested={allHarvested}
                failures={allFailures}
                shades={shades}
                size={160}
              />
            </div>
          </div>
          {allFailures.length > 0 && (
            <div>
              <h2 className="harvest-section-title">
                {t("harvest.catalogue.issues")}
              </h2>
              <HarvestReasonBars failures={allFailures} />
            </div>
          )}
        </section>
      )}

      <h2 className="harvest-section-title">{t("harvest.sources")}</h2>
      {loadingServers ? (
        <HarvestCardsSkeleton label={t("harvest.loading.sources")} />
      ) : (
        <div className="harvest-card-grid">
          {(servers || []).map((s) => (
            <ServerCard key={s.erddap_url} server={s} shades={shades} t={t} />
          ))}
        </div>
      )}

      <h2 className="harvest-section-title">{t("harvest.recentRuns")}</h2>
      {loadingRuns ? (
        <HarvestTableSkeleton label={t("harvest.loading.runs")} />
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
    </HarvestLayout>
  );
}
