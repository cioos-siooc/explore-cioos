import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import HarvestLayout from "./HarvestLayout.jsx";
import useHarvestFetch from "./useHarvestFetch.js";
import reasonLabel from "./reasonLabel.js";
import BUCKETS, { bucketByKey } from "./coverageBuckets.js";
import { slugify } from "./slug.js";
import { hostname, fmtDt, datasetLink } from "./format.js";

const OBIS_SENTINEL = "https://obis.org";

function sourceLabel(row, t) {
  return row.source === "obis" ? t("harvest.coverage.obisSource") : hostname(row.erddap_url);
}

function Stat({ label, value, tone }) {
  return (
    <div className="harvest-coverage-stat">
      <div className={`harvest-coverage-stat-value ${tone || ""}`}>{value ?? "—"}</div>
      <div className="harvest-coverage-stat-label">{label}</div>
    </div>
  );
}

// One <td> per column name in the bucket spec. Kept here rather than in the
// spec so the renderers can reach i18n and the link helpers.
function Cell({ column, row, t, ckanUrl }) {
  switch (column) {
    case "erddap_url":
      return (
        <td className="harvest-text-sm">
          {row.erddap_url ? (
            <Link
              to={`/harvest/server/${slugify(row.erddap_url)}`}
              className="harvest-link"
            >
              {hostname(row.erddap_url)}
            </Link>
          ) : (
            "—"
          )}
        </td>
      );
    case "dataset_id":
      return (
        <td className="harvest-mono harvest-text-sm">
          <a
            href={datasetLink(row.erddap_url, row.dataset_id, "erddap")}
            target="_blank"
            rel="noreferrer"
            className="harvest-link"
          >
            {row.dataset_id}
          </a>
        </td>
      );
    case "obis_dataset_id": {
      const id = row.obis_dataset_id || row.dataset_id;
      return (
        <td className="harvest-mono harvest-text-sm">
          <a
            href={`${OBIS_SENTINEL}/dataset/${id}`}
            target="_blank"
            rel="noreferrer"
            className="harvest-link"
          >
            {id}
          </a>
        </td>
      );
    }
    case "reason":
      return (
        <td className="harvest-text-sm">
          {row.reason_code ? reasonLabel(t, row.reason_code) : t("harvest.coverage.noReason")}
        </td>
      );
    case "classification":
      return (
        <td className="harvest-text-sm">
          {t(`harvest.coverage.classification.${row.classification}`)}
          {row.reason_code && (
            <div className="harvest-muted harvest-text-xs">
              {reasonLabel(t, row.reason_code)}
            </div>
          )}
        </td>
      );
    case "title":
    case "ckanTitle":
      return <td className="harvest-text-sm">{row.title || "—"}</td>;
    case "ckanRecord":
      return (
        <td className="harvest-text-sm">
          {row.ckan_id ? (
            <a
              href={`${ckanUrl}/dataset/${row.ckan_name || row.ckan_id}`}
              target="_blank"
              rel="noreferrer"
              className="harvest-link"
            >
              {t("harvest.coverage.viewOnCkan")}
            </a>
          ) : (
            "—"
          )}
        </td>
      );
    case "n_resources":
      return <td className="harvest-num">{row.n_resources ?? 0}</td>;
    case "attempted_at":
      return (
        <td className="harvest-muted harvest-text-sm">{fmtDt(row.attempted_at)}</td>
      );
    default:
      return <td>{row[column] ?? "—"}</td>;
  }
}

export default function HarvestCoverage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const bucketKey = searchParams.get("bucket") || BUCKETS[0].key;
  const bucket = bucketByKey(bucketKey) || BUCKETS[0];
  const q = searchParams.get("q") || "";

  const { data: coverage, loading } = useHarvestFetch("/coverage");
  // The path is the whole cache key, so the bucket and search term belong in
  // it — changing either refetches.
  const { data: bucketData, loading: loadingBucket } = useHarvestFetch(
    `/coverage/${bucket.key}${q ? `?q=${encodeURIComponent(q)}` : ""}`,
  );

  const summary = coverage?.summary;
  const sources = coverage?.sources || [];
  const ckanUrl = coverage?.ckanUrl || "https://catalogue.cioos.ca";

  function setParam(name, value) {
    const p = new URLSearchParams(searchParams);
    if (value) p.set(name, value);
    else p.delete(name);
    setSearchParams(p);
  }

  const breadcrumbs = (
    <>
      <Link to="/harvest">{t("harvest.title")}</Link> / {t("harvest.coverage.title")}
    </>
  );

  return (
    <HarvestLayout breadcrumbs={breadcrumbs}>
      <h1 className="harvest-page-title">{t("harvest.coverage.title")}</h1>
      <p className="harvest-page-sub">{t("harvest.coverage.subtitle")}</p>

      {loading ? (
        <div className="harvest-loading">{t("harvest.coverage.loading")}</div>
      ) : (
        <>
          <h2 className="harvest-section-title">{t("harvest.coverage.served")}</h2>
          <div className="harvest-coverage-stats">
            <Stat label={t("harvest.coverage.servedTotal")} value={summary?.n_app_total} />
            <Stat label={t("harvest.coverage.servedErddap")} value={summary?.n_app_erddap} />
            <Stat label={t("harvest.coverage.servedObis")} value={summary?.n_app_obis} />
            <Stat
              label={t("harvest.coverage.ckanRecords")}
              value={summary?.n_ckan_records}
            />
          </div>
          <p className="harvest-muted harvest-text-sm">
            {t("harvest.coverage.snapshot", {
              date: fmtDt(summary?.ckan_snapshot_at),
            })}
          </p>

          {!summary?.n_ckan_records && (
            <div className="harvest-queue-warning">
              {t("harvest.coverage.noSnapshot")}
            </div>
          )}

          <h2 className="harvest-section-title">{t("harvest.coverage.sources")}</h2>
          <table className="harvest-table">
            <thead>
              <tr>
                <th>{t("harvest.coverage.col.source")}</th>
                <th>{t("harvest.coverage.col.kind")}</th>
                <th className="harvest-num">{t("harvest.coverage.col.advertised")}</th>
                <th className="harvest-num">{t("harvest.coverage.col.notInApp")}</th>
                <th className="harvest-num">{t("harvest.coverage.col.withoutCkan")}</th>
                <th>{t("harvest.coverage.col.lastAttempt")}</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={`${s.erddap_url}-${s.source}`}>
                  <td className="harvest-text-sm">
                    <Link
                      to={`/harvest/server/${slugify(s.erddap_url)}`}
                      className="harvest-link"
                    >
                      {sourceLabel(s, t)}
                    </Link>
                  </td>
                  <td className="harvest-muted harvest-text-sm">
                    {t("harvest.coverage.kind.data")}
                  </td>
                  <td className="harvest-num">{s.n_advertised}</td>
                  <td
                    className={`harvest-num ${Number(s.n_not_in_app) > 0 ? "harvest-error-text" : ""}`}
                  >
                    {s.n_not_in_app}
                  </td>
                  <td className="harvest-num">{s.n_without_ckan}</td>
                  <td className="harvest-muted harvest-text-sm">
                    {fmtDt(s.last_attempted_at)}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="harvest-text-sm">
                  <a
                    href={ckanUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="harvest-link"
                  >
                    {hostname(ckanUrl)}
                  </a>
                </td>
                <td className="harvest-muted harvest-text-sm">
                  {t("harvest.coverage.kind.metadata")}
                </td>
                <td className="harvest-num">{summary?.n_ckan_records}</td>
                <td className="harvest-num">{summary?.n_ckan_not_in_app}</td>
                <td className="harvest-num">—</td>
                <td className="harvest-muted harvest-text-sm">
                  {fmtDt(summary?.ckan_snapshot_at)}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="harvest-muted harvest-text-sm">
            {t("harvest.coverage.linksNote", {
              erddap: summary?.n_ckan_erddap_links ?? 0,
              obis: summary?.n_ckan_obis_links ?? 0,
            })}
          </p>
        </>
      )}

      <h2 className="harvest-section-title">{t("harvest.coverage.gaps")}</h2>
      <div className="harvest-coverage-buckets">
        {BUCKETS.map((b) => (
          <button
            key={b.key}
            type="button"
            className={`harvest-coverage-bucket ${b.key === bucket.key ? "is-active" : ""}`}
            onClick={() => setParam("bucket", b.key)}
          >
            {t(`harvest.coverage.bucket.${b.key}.label`)}
            <span className="harvest-coverage-bucket-count">
              {summary?.[b.countKey] ?? "—"}
            </span>
          </button>
        ))}
      </div>

      <p className="harvest-page-sub">
        {t(`harvest.coverage.bucket.${bucket.key}.help`)}
      </p>

      <input
        className="harvest-coverage-search"
        type="search"
        value={q}
        placeholder={t("harvest.coverage.searchPlaceholder")}
        onChange={(e) => setParam("q", e.target.value)}
      />

      {loadingBucket ? (
        <div className="harvest-loading">{t("harvest.coverage.loading")}</div>
      ) : !bucketData || bucketData.rows.length === 0 ? (
        <div className="harvest-muted">{t("harvest.coverage.empty")}</div>
      ) : (
        <>
          <table className="harvest-table">
            <thead>
              <tr>
                {bucket.columns.map((c) => (
                  <th
                    key={c}
                    className={c === "n_resources" ? "harvest-num" : undefined}
                  >
                    {t(`harvest.coverage.col.${c}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bucketData.rows.map((row, i) => (
                <tr key={`${row.ckan_id || row.erddap_url}-${row.dataset_id || row.obis_dataset_id}-${i}`}>
                  {bucket.columns.map((c) => (
                    <Cell key={c} column={c} row={row} t={t} ckanUrl={ckanUrl} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {bucketData.truncated && (
            <p className="harvest-muted harvest-text-sm">
              {t("harvest.coverage.truncated", { count: bucketData.limit })}
            </p>
          )}
        </>
      )}
    </HarvestLayout>
  );
}
