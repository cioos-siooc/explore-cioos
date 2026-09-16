import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import HarvestLayout from "./HarvestLayout.jsx";
import useHarvestFetch from "./useHarvestFetch.js";
import reasonLabel from "./reasonLabel.js";
import BUCKETS, { bucketByKey } from "./coverageBuckets.js";
import CoverageDonut from "./CoverageDonut.jsx";
import { slugify } from "./slug.js";
import { hostname, fmtDt, datasetLink } from "./format.js";
import { server } from "../../config.js";

const OBIS_SENTINEL = "https://obis.org";

function sourceLabel(row, t) {
  return row.source === "obis"
    ? t("harvest.coverage.obisSource")
    : hostname(row.erddap_url);
}

function Stat({ label, value, tone }) {
  return (
    <div className="harvest-coverage-stat">
      <div className={`harvest-coverage-stat-value ${tone || ""}`}>
        {value ?? "—"}
      </div>
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
          {row.reason_code
            ? reasonLabel(t, row.reason_code)
            : t("harvest.coverage.noReason")}
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
    case "linkTarget":
      if (row.erddap_url) {
        return (
          <td className="harvest-text-sm">
            <a
              href={datasetLink(row.erddap_url, row.dataset_id, "erddap")}
              target="_blank"
              rel="noreferrer"
              className="harvest-link harvest-mono"
            >
              {row.dataset_id}
            </a>
            <div className="harvest-muted harvest-text-xs">
              {hostname(row.erddap_url)}
            </div>
          </td>
        );
      }
      if (row.obis_dataset_id) {
        return (
          <td className="harvest-text-sm">
            <a
              href={`${OBIS_SENTINEL}/dataset/${row.obis_dataset_id}`}
              target="_blank"
              rel="noreferrer"
              className="harvest-link harvest-mono"
            >
              {row.obis_dataset_id}
            </a>
            <div className="harvest-muted harvest-text-xs">OBIS</div>
          </td>
        );
      }
      return (
        <td className="harvest-muted harvest-text-sm">
          {t("harvest.coverage.noLink", { count: row.n_resources ?? 0 })}
        </td>
      );
    case "n_resources":
      return <td className="harvest-num">{row.n_resources ?? 0}</td>;
    case "attempted_at":
      return (
        <td className="harvest-muted harvest-text-sm">
          {fmtDt(row.attempted_at)}
        </td>
      );
    default:
      return <td>{row[column] ?? "—"}</td>;
  }
}

function buildIntegration(summary, t) {
  const n = (key) => Number(summary[key] || 0);
  const erddapIn = n("n_app_erddap");
  const erddapOut = n("n_erddap_not_in_app");
  const obisIn = n("n_app_obis");
  const obisOut = n("n_obis_not_harvested");
  // Datasets CKAN describes that no configured source advertises, plus the
  // records that point at nothing CDE can read. Both are computed to be
  // disjoint from the two gaps above — a CKAN record naming a dataset whose
  // harvest failed describes a dataset already counted in erddapOut, so
  // counting "CKAN records not integrated" here would double it.
  const ckanOnly = n("n_ckan_only_datasets");
  const ckanNoData = n("n_ckan_no_data_source");

  const integrated = erddapIn + obisIn;
  const missing = erddapOut + obisOut + ckanOnly + ckanNoData;
  const total = integrated + missing;
  if (!total) return null;

  // Ring 2's order matches ring 1's so the two levels line up radially: the
  // integrated sources sweep first, then the missing ones.
  return {
    total,
    integrated,
    rings: [
      [
        {
          key: "integrated",
          label: t("harvest.coverage.viz.integrated"),
          value: integrated,
          color: "--harvest-viz-integrated",
        },
        {
          key: "missing",
          label: t("harvest.coverage.viz.missing"),
          value: missing,
          color: "--harvest-viz-gap",
        },
      ],
      [
        {
          key: "erddap-in",
          label: t("harvest.coverage.viz.erddapIn"),
          value: erddapIn,
          color: "--harvest-viz-erddap",
        },
        {
          key: "obis-in",
          label: t("harvest.coverage.viz.obisIn"),
          value: obisIn,
          color: "--harvest-viz-obis",
        },
        {
          key: "erddap-out",
          label: t("harvest.coverage.viz.erddapOut"),
          value: erddapOut,
          color: "--harvest-viz-erddap-soft",
        },
        {
          key: "obis-out",
          label: t("harvest.coverage.viz.obisOut"),
          value: obisOut,
          color: "--harvest-viz-obis-soft",
        },
        // CKAN has no "integrated" segment: a record whose dataset IS served is
        // already counted under the source that serves it.
        {
          key: "ckan-only",
          label: t("harvest.coverage.viz.ckanOnly"),
          value: ckanOnly,
          color: "--harvest-viz-ckan",
        },
        {
          key: "ckan-nodata",
          label: t("harvest.coverage.viz.ckanNoData"),
          value: ckanNoData,
          color: "--harvest-viz-ckan-soft",
        },
      ],
    ],
  };
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

  // The donut's universe is what CDE's OWN configured sources offer: every
  // dataset an ERDDAP server advertises plus every dataset OBIS discovery
  // selected, united with what the app already serves. Deliberately NOT the
  // whole CKAN catalogue — most of those records describe servers CDE was
  // never asked to harvest, and folding them in would swamp the fraction with
  // datasets nobody expected to be integrated.
  const integration = summary && buildIntegration(summary, t);

  function setParam(name, value) {
    const p = new URLSearchParams(searchParams);
    if (value) p.set(name, value);
    else p.delete(name);
    setSearchParams(p);
  }

  const breadcrumbs = (
    <>
      <Link to="/harvest">{t("harvest.title")}</Link> /{" "}
      {t("harvest.coverage.title")}
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
          <h2 className="harvest-section-title">
            {t("harvest.coverage.served")}
          </h2>
          <div className="harvest-coverage-stats">
            <Stat
              label={t("harvest.coverage.servedTotal")}
              value={summary?.n_app_total}
            />
            <Stat
              label={t("harvest.coverage.servedErddap")}
              value={summary?.n_app_erddap}
            />
            <Stat
              label={t("harvest.coverage.servedObis")}
              value={summary?.n_app_obis}
            />
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

          {integration && (
            <>
              <h2 className="harvest-section-title">
                {t("harvest.coverage.integrationTitle")}
              </h2>
              <CoverageDonut
                rings={integration.rings}
                total={integration.total}
                centerLabel={t("harvest.coverage.integratedCenter")}
                caption={t("harvest.coverage.integrationCaption", {
                  integrated: integration.integrated.toLocaleString(),
                  total: integration.total.toLocaleString(),
                })}
                hint={t("harvest.coverage.vizHint")}
              />
            </>
          )}

          {!summary?.n_ckan_records && (
            <div className="harvest-queue-warning">
              {t("harvest.coverage.noSnapshot")}
            </div>
          )}

          <h2 className="harvest-section-title">
            {t("harvest.coverage.sources")}
          </h2>
          <table className="harvest-table">
            <thead>
              <tr>
                <th>{t("harvest.coverage.col.source")}</th>
                <th>{t("harvest.coverage.col.kind")}</th>
                <th className="harvest-num">
                  {t("harvest.coverage.col.advertised")}
                </th>
                <th className="harvest-num">
                  {t("harvest.coverage.col.notInApp")}
                </th>
                <th className="harvest-num">
                  {t("harvest.coverage.col.withoutCkan")}
                </th>
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
                {/* The same measure the bucket below counts: records with
                    nothing CDE serves behind them. n_ckan_not_in_app counts
                    only the ERDDAP-linked subset, which read as a different
                    number under an identical column heading. */}
                <td className="harvest-num">
                  {summary?.n_ckan_not_integrated}
                </td>
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

      <div className="harvest-coverage-toolbar">
        <input
          className="harvest-coverage-search"
          type="search"
          value={q}
          placeholder={t("harvest.coverage.searchPlaceholder")}
          onChange={(e) => setParam("q", e.target.value)}
        />
        {bucket.exportable && (
          // The table is capped, so "the whole list" has to leave by another
          // door — and these get worked through in a spreadsheet anyway.
          <a
            className="harvest-link harvest-text-sm"
            href={`${server}/harvest/coverage/${bucket.key}?format=csv${
              q ? `&q=${encodeURIComponent(q)}` : ""
            }`}
          >
            {t("harvest.coverage.downloadCsv")}
          </a>
        )}
      </div>

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
                <tr
                  key={`${row.ckan_id || row.erddap_url}-${row.dataset_id || row.obis_dataset_id}-${i}`}
                >
                  {bucket.columns.map((c) => (
                    <Cell
                      key={c}
                      column={c}
                      row={row}
                      t={t}
                      ckanUrl={ckanUrl}
                    />
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
