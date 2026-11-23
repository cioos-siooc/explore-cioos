import React from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import HarvestLayout from "./HarvestLayout.jsx";
import {
  HarvestCardsSkeleton,
  HarvestTableSkeleton,
} from "./HarvestSkeleton.jsx";
import StatusBadge from "./StatusBadge.jsx";
import Spinner from "../ui/Spinner.jsx";
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

// Holds the section's place while CKAN is paged through on a cold cache.
function SectionLoading({ titleKey, descKey, t }) {
  return (
    <div>
      <h3 className="harvest-section-title">{t(titleKey)}</h3>
      <p className="harvest-section-desc">{t(descKey)}</p>
      <div className="harvest-section-loading" role="status">
        <Spinner size="md" role="presentation" />
        <span>{t("harvest.loading.ckanCoverage")}</span>
      </div>
    </div>
  );
}

// ERDDAP servers are steps of one blue (ordinal, darkest = most records) so a
// shade never implies the same server across rows; OBIS keeps its own hue.
const SERVER_SHADES = ["#104281", "#256abf", "#5598e7", "#86b6ef"];
const OBIS_COLOR = "#eb6834";
const NONE_COLOR = "var(--harvest-input-border)";

// A record linked from both sources sits in its server's segment; the overlap
// is what n_erddap and n_obis together overshoot n_linked by. Records
// pointing to several servers (none today) would be counted once per server.
function linkSegments(s, total, t) {
  const servers = s.erddap_servers || [];
  const named =
    servers.length > SERVER_SHADES.length
      ? servers.slice(0, SERVER_SHADES.length - 1)
      : servers;
  const folded = servers.slice(named.length);
  const both = Math.max(0, s.n_erddap + s.n_obis - s.n_linked);
  return [
    ...named.map((srv, i) => ({
      key: srv.erddap_url,
      label: hostname(srv.erddap_url),
      n: srv.n_records,
      color: SERVER_SHADES[i],
      to: `/harvest/server/${slugify(srv.erddap_url)}`,
    })),
    ...(folded.length
      ? [
          {
            key: "other",
            label: t("harvest.ckanCoverage.otherServers", {
              count: folded.length,
            }),
            n: folded.reduce((sum, srv) => sum + srv.n_records, 0),
            color: SERVER_SHADES[SERVER_SHADES.length - 1],
            members: folded
              .map((srv) => `${hostname(srv.erddap_url)}: ${srv.n_records}`)
              .join("\n"),
          },
        ]
      : []),
    {
      key: "obis",
      label: t("harvest.ckanCoverage.link.obis"),
      n: s.n_obis - both,
      color: OBIS_COLOR,
    },
    {
      key: "none",
      label: t("harvest.ckanCoverage.link.none"),
      n: total == null ? 0 : total - s.n_linked,
      color: NONE_COLOR,
    },
  ].filter((seg) => seg.n > 0);
}

const describe = (segments) =>
  segments.map((seg) => `${seg.label}: ${seg.n}`).join(", ");

function LinkBar({ segments, label }) {
  return (
    <div className="harvest-stack-bar" role="img" aria-label={label}>
      {segments.map((seg) => (
        <span
          key={seg.key}
          style={{ flexGrow: seg.n, background: seg.color }}
          title={`${seg.label}: ${seg.n}`}
        />
      ))}
    </div>
  );
}

// The bar's legend: each server links to its page; OBIS has none.
function SegmentLegend({ segments, label }) {
  if (!segments.length) return null;
  return (
    <ul className="harvest-pie-legend harvest-link-legend" aria-label={label}>
      {segments.map((seg) => (
        <li key={seg.key} title={seg.members}>
          <span
            className="harvest-pie-swatch"
            style={{ background: seg.color }}
            aria-hidden="true"
          />
          <span className="harvest-pie-name">
            {seg.to ? (
              <Link to={seg.to} className="harvest-link">
                {seg.label}
              </Link>
            ) : (
              seg.label
            )}
          </span>
          <span className="harvest-pie-value">{seg.n}</span>
        </li>
      ))}
    </ul>
  );
}

function CkanCoverage({ coverage, t }) {
  const total = coverage.n_ckan_records;
  const pct = total ? Math.round((100 * coverage.n_linked) / total) : null;
  const ratio =
    pct !== null
      ? t("harvest.ckanCoverage.ratio", { linked: coverage.n_linked, total })
      : t("harvest.ckanCoverage.unavailable", { linked: coverage.n_linked });
  const overall = linkSegments(coverage, total, t);
  return (
    <div>
      <h3 className="harvest-section-title">
        {t("harvest.ckanCoverage.title")}
      </h3>
      <p className="harvest-section-desc">
        {t("harvest.ckanCoverage.caption")}
      </p>
      {pct !== null && <div className="harvest-ckan-pct">{pct}%</div>}
      <LinkBar segments={overall} label={ratio} />
      <p className="harvest-card-meta">{ratio}</p>
      <SegmentLegend
        segments={overall}
        label={t("harvest.ckanCoverage.dataFrom")}
      />
      {coverage.sources && (
        <ul className="harvest-ckan-sources">
          {coverage.sources.map((s) => {
            const sourcePct = s.n_records
              ? Math.round((100 * s.n_linked) / s.n_records)
              : 0;
            const segments = linkSegments(s, s.n_records, t);
            const linked = segments.filter((seg) => seg.key !== "none");
            return (
              <li key={s.source ?? ""}>
                <span className="harvest-pie-name">
                  {s.source ?? t("harvest.ckanCoverage.unknownSource")}
                </span>
                <span className="harvest-pie-value">
                  {t("harvest.ckanCoverage.sourceRatio", {
                    linked: s.n_linked,
                    total: s.n_records,
                    pct: sourcePct,
                  })}
                </span>
                <LinkBar segments={segments} label={describe(segments)} />
                <SegmentLegend
                  segments={linked}
                  label={t("harvest.ckanCoverage.dataFrom")}
                />
              </li>
            );
          })}
        </ul>
      )}
      {coverage.n_linked_stale > 0 && (
        <p className="harvest-card-meta">
          {t("harvest.ckanCoverage.stale", { count: coverage.n_linked_stale })}
        </p>
      )}
    </div>
  );
}

// Categorical slots 1–7 of the dataviz reference palette, in order, with
// "Other" in the pie's neutral grey; validated as adjacent stack pairs.
const SOURCE_COLORS = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#6250d6",
];
const OTHER_SOURCE_COLOR = "#8a8984";

// Largest first, so a source keeps its colour while the counts hold their
// order; past the palette the remainder folds into "Other".
function unmatchedBySource(harvested, otherLabel) {
  const ranked = harvested
    .map((s) => ({
      key: s.erddap_url,
      label: hostname(s.erddap_url),
      n: s.n_datasets - s.n_matched,
    }))
    .filter((s) => s.n > 0)
    .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
  const shown = ranked
    .slice(0, SOURCE_COLORS.length)
    .map((s, i) => ({ ...s, color: SOURCE_COLORS[i] }));
  const otherN = ranked
    .slice(SOURCE_COLORS.length)
    .reduce((sum, s) => sum + s.n, 0);
  return otherN
    ? [
        ...shown,
        { key: "", label: otherLabel, n: otherN, color: OTHER_SOURCE_COLOR },
      ]
    : shown;
}

function UnmatchedBar({ harvested, t }) {
  const segments = unmatchedBySource(
    harvested,
    t("harvest.ckanCoverage.otherSources"),
  );
  const total = segments.reduce((sum, s) => sum + s.n, 0);
  if (!total) return null;
  const label = t("harvest.ckanCoverage.notInCkan", { count: total });
  return (
    <div className="harvest-unmatched">
      <div className="harvest-unmatched-title">{label}</div>
      <div className="harvest-unmatched-bar" role="img" aria-label={label}>
        {segments.map((s) => (
          <span
            key={s.key}
            style={{ flexGrow: s.n, background: s.color }}
            title={`${s.label}: ${s.n}`}
          />
        ))}
      </div>
      <ul className="harvest-pie-legend">
        {segments.map((s) => (
          <li key={s.key}>
            <span
              className="harvest-pie-swatch"
              style={{ background: s.color }}
              aria-hidden="true"
            />
            <span className="harvest-pie-name">{s.label}</span>
            <span className="harvest-pie-value">
              {s.n} · {Math.round((100 * s.n) / total)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HarvestedInCkan({ harvested, t }) {
  const total = harvested.reduce((sum, s) => sum + s.n_datasets, 0);
  const matched = harvested.reduce((sum, s) => sum + s.n_matched, 0);
  const pct = total ? Math.round((100 * matched) / total) : 0;
  const ratio = t("harvest.ckanCoverage.harvestedRatio", { matched, total });
  return (
    <div>
      <h3 className="harvest-section-title">
        {t("harvest.ckanCoverage.harvestedTitle")}
      </h3>
      <p className="harvest-section-desc">
        {t("harvest.ckanCoverage.harvestedDesc")}
      </p>
      <div className="harvest-ckan-pct">{pct}%</div>
      <div className="harvest-ckan-meter" role="img" aria-label={ratio}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="harvest-card-meta">{ratio}</p>
      <UnmatchedBar harvested={harvested} t={t} />
      <ul className="harvest-ckan-sources">
        {harvested.map((s) => {
          const matchedPct = s.n_datasets
            ? Math.round((100 * s.n_matched) / s.n_datasets)
            : 0;
          return (
            <li key={s.erddap_url}>
              <span className="harvest-pie-name">{hostname(s.erddap_url)}</span>
              <span className="harvest-pie-value">
                {t("harvest.ckanCoverage.sourceRatio", {
                  linked: s.n_matched,
                  total: s.n_datasets,
                  pct: matchedPct,
                })}
              </span>
              {s.n_datasets > s.n_matched && (
                <span className="harvest-muted">
                  {t("harvest.ckanCoverage.unmatched", {
                    count: s.n_datasets - s.n_matched,
                  })}
                </span>
              )}
              <div className="harvest-ckan-meter" aria-hidden="true">
                <span style={{ width: `${matchedPct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function HarvestOverview() {
  const { t } = useTranslation();
  const { data: servers, loading: loadingServers } =
    useHarvestFetch("/servers");
  const { data: runs, loading: loadingRuns } = useHarvestFetch("/runs/recent");
  const { data: ckanCoverage, loading: loadingCkan } =
    useHarvestFetch("/ckan-coverage");

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

      <div className="harvest-columns">
        <section aria-labelledby="harvest-col-metadata">
          <h2 id="harvest-col-metadata" className="harvest-column-title">
            {t("harvest.columns.metadata")}
          </h2>
          <p className="harvest-section-desc">
            {t("harvest.columns.metadataDesc")}
          </p>
          {loadingCkan && (
            <SectionLoading
              titleKey="harvest.ckanCoverage.title"
              descKey="harvest.ckanCoverage.caption"
              t={t}
            />
          )}
          {ckanCoverage && <CkanCoverage coverage={ckanCoverage} t={t} />}
        </section>
        <section aria-labelledby="harvest-col-data">
          <h2 id="harvest-col-data" className="harvest-column-title">
            {t("harvest.columns.data")}
          </h2>
          <p className="harvest-section-desc">
            {t("harvest.columns.dataDesc")}
          </p>
          {loadingCkan && (
            <SectionLoading
              titleKey="harvest.ckanCoverage.harvestedTitle"
              descKey="harvest.ckanCoverage.harvestedDesc"
              t={t}
            />
          )}
          {ckanCoverage?.harvested?.length > 0 && (
            <HarvestedInCkan harvested={ckanCoverage.harvested} t={t} />
          )}
        </section>
      </div>

      {servers && servers.length > 0 && (
        <section className="harvest-catalogue">
          <div>
            <h2 className="harvest-section-title">
              {t("harvest.catalogue.title")}
            </h2>
            <p className="harvest-section-desc">
              {t("harvest.catalogue.desc")}
            </p>
            <div className="harvest-pie-detail">
              <HarvestPie
                harvested={allHarvested}
                failures={allFailures}
                shades={shades}
                bar
              />
            </div>
          </div>
          {allFailures.length > 0 && (
            <div>
              <h2 className="harvest-section-title">
                {t("harvest.catalogue.issues")}
              </h2>
              <p className="harvest-section-desc">
                {t("harvest.catalogue.issuesDesc")}
              </p>
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
