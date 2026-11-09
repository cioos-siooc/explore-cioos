import React, { useState } from "react";
import { useParams, useSearchParams, Link } from "react-router";
import { useTranslation } from "react-i18next";
import HarvestLayout from "./HarvestLayout.jsx";
import { HarvestTableSkeleton } from "./HarvestSkeleton.jsx";
import StatusBadge from "./StatusBadge.jsx";
import HarvestModeBadge from "./HarvestModeBadge.jsx";
import HarvestRealtimeBadge from "./HarvestRealtimeBadge.jsx";
import Sparkline from "./Sparkline.jsx";
import HarvestPie, {
  datasetFailures,
  reasonShades,
  sliceKey,
} from "./HarvestPie.jsx";
import useHarvestFetch from "./useHarvestFetch.js";
import reasonLabel from "./reasonLabel.js";
import warningLabel from "./warningLabel.js";
import { harvestMode } from "./harvestMode.js";
import { slugify } from "./slug.js";
import { hostname, fmtDt, fmtDurationMs, datasetLink } from "./format.js";

export default function HarvestServer() {
  const { t } = useTranslation();
  const { slug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState(
    searchParams.get("status") || "",
  );
  const [q, setQ] = useState(searchParams.get("q") || "");
  const warning = searchParams.get("warning") || "";
  const reason = searchParams.get("reason") || "";

  const qs = new URLSearchParams();
  if (statusFilter) qs.set("status", statusFilter);
  if (q) qs.set("q", q);
  if (warning) qs.set("warning", warning);
  const queryStr = qs.toString();

  const { data: datasets, loading } = useHarvestFetch(
    `/servers/${slug}${queryStr ? "?" + queryStr : ""}`,
  );
  // The pie always charts the whole server, so a filtered table needs the
  // unfiltered rows fetched alongside it.
  const { data: allDatasets } = useHarvestFetch(
    queryStr ? `/servers/${slug}` : null,
  );
  const pieRows = queryStr ? allDatasets : datasets;
  const rows = reason
    ? (datasets || []).filter((d) => d.reason_code === reason)
    : datasets;
  // The slug is a transformed source URL; the full erddap_url (and a clean
  // hostname for display) come from the dataset rows once loaded.
  const erddapUrl = (datasets && datasets[0] && datasets[0].erddap_url) || "";
  const host = hostname(erddapUrl) || slug;
  const { data: warningSummary } = useHarvestFetch(`/warnings/${slug}`);

  function applyFilters(
    newStatus,
    newQ,
    newWarning = warning,
    newReason = reason,
  ) {
    const p = {};
    if (newStatus) p.status = newStatus;
    if (newQ) p.q = newQ;
    if (newWarning) p.warning = newWarning;
    if (newReason) p.reason = newReason;
    setSearchParams(p);
  }

  const selectedSlice =
    reason || statusFilter === "success"
      ? sliceKey(statusFilter, reason)
      : null;
  function selectSlice(slice) {
    const off = slice.key === selectedSlice;
    setStatusFilter(off ? "" : slice.status);
    applyFilters(off ? "" : slice.status, q, warning, off ? "" : slice.reason);
  }

  const failures = datasetFailures(pieRows);
  const nHarvested = (pieRows || []).filter(
    (d) => d.status === "success",
  ).length;
  const nIncremental = (datasets || []).filter(
    (d) => harvestMode(d) === "incremental",
  ).length;

  const breadcrumbs = (
    <>
      <Link to="/harvest">{t("harvest.title")}</Link> / {host}
    </>
  );

  return (
    <HarvestLayout breadcrumbs={breadcrumbs}>
      <h1 className="harvest-page-title">{host}</h1>
      <p className="harvest-page-sub">
        {erddapUrl && (
          <a
            href={erddapUrl}
            target="_blank"
            rel="noreferrer"
            className="harvest-link"
          >
            {erddapUrl}
          </a>
        )}
      </p>

      <p className="harvest-muted harvest-text-md">
        {t("harvest.datasetsCount", { count: (rows || []).length })}
      </p>

      <div className="harvest-pie-detail">
        <HarvestPie
          harvested={nHarvested}
          failures={failures}
          shades={reasonShades([failures])}
          size={160}
          onSelect={selectSlice}
          selected={selectedSlice}
        />
      </div>

      {nIncremental > 0 && (
        <div className="harvest-summary">
          <span
            className="harvest-count-pill harvest-count-files"
            title={t("harvest.mode.incremental.tip")}
          >
            📁 {t("harvest.server.incrementalCount", { count: nIncremental })}
          </span>
        </div>
      )}

      {warningSummary && warningSummary.length > 0 && (
        <details style={{ marginBottom: "1rem" }}>
          <summary className="harvest-clickable harvest-text-md harvest-muted-strong">
            {t("harvest.warnings.title")} ({warningSummary.length})
          </summary>
          <table
            className="harvest-table"
            style={{ maxWidth: 520, marginTop: "0.5rem" }}
          >
            <thead>
              <tr>
                <th>{t("harvest.col.warning")}</th>
                <th>{t("harvest.col.datasets")}</th>
                <th>{t("harvest.col.count")}</th>
              </tr>
            </thead>
            <tbody>
              {warningSummary.map((w) => (
                <tr key={w.code}>
                  <td>
                    <button
                      type="button"
                      className="harvest-clickable harvest-text-sm"
                      style={{
                        background: "none",
                        border: 0,
                        padding: 0,
                        textAlign: "left",
                        color: "var(--cioos-primary-700)",
                      }}
                      title={t("harvest.warnings.filterBy")}
                      aria-pressed={warning === w.code}
                      onClick={() => applyFilters(statusFilter, q, w.code)}
                    >
                      ⚠ {warningLabel(t, w.code)}
                    </button>
                  </td>
                  <td className="harvest-num-total">{w.n_datasets}</td>
                  <td className="harvest-num-total">{w.total_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      <div className="harvest-filter-bar">
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            applyFilters(e.target.value, q, warning, "");
          }}
        >
          <option value="">{t("harvest.filter.allStatuses")}</option>
          <option value="success">{t("harvest.filter.success")}</option>
          <option value="skipped">{t("harvest.filter.skipped")}</option>
          <option value="error">{t("harvest.filter.error")}</option>
        </select>
        <input
          type="text"
          placeholder={t("harvest.filter.searchPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") applyFilters(statusFilter, q);
          }}
        />
        <button
          className="harvest-text-md harvest-clickable harvest-btn-sm"
          onClick={() => applyFilters(statusFilter, q)}
        >
          {t("harvest.filter.search")}
        </button>
        {warning && (
          <span
            className="harvest-count-pill harvest-warning-text"
            style={{
              background: "var(--harvest-warn-bg)",
              border: "1px solid var(--harvest-warn-border)",
            }}
          >
            ⚠ {t("harvest.warning.label")}: {warningLabel(t, warning)}{" "}
            <button
              type="button"
              className="harvest-clickable harvest-btn-sm"
              aria-label={t("harvest.warnings.clearFilter")}
              title={t("harvest.warnings.clearFilter")}
              onClick={() => applyFilters(statusFilter, q, "")}
            >
              ✕
            </button>
          </span>
        )}
        {(statusFilter || q || warning || reason) && (
          <button
            className="harvest-text-md harvest-clickable harvest-btn-sm harvest-muted-soft"
            onClick={() => {
              setStatusFilter("");
              setQ("");
              setSearchParams({});
            }}
          >
            {t("harvest.filter.clear")}
          </button>
        )}
      </div>

      {loading ? (
        <HarvestTableSkeleton label={t("harvest.loading.datasets")} />
      ) : (
        <table className="harvest-table">
          <thead>
            <tr>
              <th>{t("harvest.col.status")}</th>
              <th>{t("harvest.col.datasetId")}</th>
              <th>{t("harvest.col.hashable")}</th>
              <th>{t("harvest.col.realtime")}</th>
              <th>{t("harvest.col.recent")}</th>
              <th>{t("harvest.col.reason")}</th>
              <th>{t("harvest.col.lastUpdate")}</th>
              <th>{t("harvest.col.lastCheck")}</th>
              <th>{t("harvest.col.duration")}</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((d) => {
              const datasetSlug = slugify(d.erddap_url);
              return (
                <tr key={d.dataset_id}>
                  <td>
                    <StatusBadge status={d.status} />
                  </td>
                  <td>
                    <Link
                      to={`/harvest/dataset/${datasetSlug}/${encodeURIComponent(d.dataset_id)}`}
                      className="harvest-link harvest-mono harvest-text-sm"
                    >
                      {d.dataset_id}
                    </Link>{" "}
                    <a
                      href={datasetLink(d.erddap_url, d.dataset_id, d.source)}
                      target="_blank"
                      rel="noreferrer"
                      className="harvest-muted harvest-text-xs"

                      title={t("harvest.server.viewOnSource")}
                    >
                      ↗
                    </a>
                  </td>
                  <td>
                    <HarvestModeBadge dataset={d} />
                  </td>
                  <td>
                    <HarvestRealtimeBadge isRealtime={d.is_realtime} />
                  </td>
                  <td>
                    <Sparkline statuses={d.history_statuses} />
                  </td>
                  <td>
                    {d.reason_code ? (
                      <span className="harvest-text-sm" title={d.reason_code}>
                        {reasonLabel(t, d.reason_code)}
                      </span>
                    ) : d.warnings?.length > 0 ? (
                      <span
                        className="harvest-warning-text"
                        title={d.warnings.map((w) => w.message).join("\n")}
                      >
                        ⚠ {warningLabel(t, d.warnings[0].code)}
                        {d.warnings.length > 1 &&
                          ` ${t("harvest.warnings.more", { count: d.warnings.length - 1 })}`}
                      </span>
                    ) : (
                      <span className="harvest-muted">—</span>
                    )}
                  </td>
                  <td className="harvest-muted harvest-text-sm">
                    {fmtDt(d.last_updated_at)}
                  </td>
                  <td className="harvest-muted harvest-text-sm">
                    {fmtDt(d.attempted_at)}
                  </td>
                  <td className="harvest-muted harvest-text-sm">
                    {fmtDurationMs(d.duration_ms)}
                  </td>
                </tr>
              );
            })}
            {!loading && (!rows || rows.length === 0) && (
              <tr>
                <td colSpan="9" className="harvest-empty-row">
                  {t("harvest.server.noDatasets")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </HarvestLayout>
  );
}
