import React from "react";
import { useTranslation } from "react-i18next";
import reasonLabel from "./reasonLabel.js";

// The status pills' colours (--cioos-success / --cioos-error / --cioos-warn),
// each reason a shade of its status. Shade order and the slice order below
// (harvested, errors, skips) keep neighbouring slices apart under
// colour-blindness, validated with the dataviz palette script.
const HARVESTED_COLOR = "#52a79b";
const SHADES = {
  error: ["#e25563", "#8f2230", "#f29aa3"],
  skipped: ["#b07a00", "#6b4a00", "#e3b33f"],
};
const STATUS_ORDER = ["error", "skipped"];
const OTHER_COLOR = "#8a8984";
// Skips a source asked for: greyed out so they don't read as problems.
const DISABLED_COLOR = "#cfcdc6";
const DISABLED_REASONS = new Set(["INGEST_FLAG_FALSE"]);
export const isDisabled = (f) => DISABLED_REASONS.has(f.reason_code);
const OTHER_KEY = "__other__";

const failureKey = (f) => `${f.status}|${f.reason_code || ""}`;

// The overview's per-server failures; a server row without the reasons
// breakdown still splits by status rather than reading as fully harvested.
export function serverFailures(server) {
  return (
    server.reasons || [
      {
        status: "skipped",
        reason_code: null,
        n: Number(server.n_skipped) || 0,
      },
      { status: "error", reason_code: null, n: Number(server.n_error) || 0 },
    ]
  );
}

// Sums failure lists by status and reason, largest first.
export function mergeFailures(failureLists) {
  const byKey = new Map();
  for (const f of failureLists.flat()) {
    const sum = byKey.get(failureKey(f)) || {
      status: f.status,
      reason_code: f.reason_code || null,
      n: 0,
    };
    sum.n += f.n;
    byKey.set(failureKey(f), sum);
  }
  return [...byKey.values()].sort(
    (a, b) => b.n - a.n || failureKey(a).localeCompare(failureKey(b)),
  );
}

// The same breakdown tallied from one server's dataset rows.
export function datasetFailures(datasets) {
  return mergeFailures([
    (datasets || [])
      .filter((d) => d.status !== "success")
      .map((d) => ({ status: d.status, reason_code: d.reason_code, n: 1 })),
  ]);
}

// Colours follow the reason, not its rank on a card: rank reasons across every
// server's failures so a reason wears the same shade wherever it appears.
export function reasonShades(failureLists) {
  const ranked = mergeFailures(failureLists);
  const shades = new Map();
  for (const status of STATUS_ORDER) {
    ranked
      .filter((f) => f.status === status && !isDisabled(f))
      .slice(0, SHADES[status].length)
      .forEach((f, i) => shades.set(failureKey(f), i));
  }
  return shades;
}

// One colour per failure for marks that don't distinguish reasons by shade.
export const failureColor = (f) =>
  isDisabled(f) ? DISABLED_COLOR : (SHADES[f.status]?.[0] ?? OTHER_COLOR);

function slicesFor(harvested, failures, shades, t) {
  const slices = [
    {
      key: "harvested",
      label: t("harvest.pie.harvested"),
      n: harvested,
      color: HARVESTED_COLOR,
      status: "success",
      reason: null,
    },
  ];
  const ranked = [];
  let other = 0;
  for (const f of failures) {
    const shade = shades.get(failureKey(f));
    const disabled = isDisabled(f);
    if (!disabled && (shade === undefined || !SHADES[f.status])) {
      other += f.n;
      continue;
    }
    ranked.push({
      key: failureKey(f),
      label: f.reason_code
        ? reasonLabel(t, f.reason_code)
        : t(`harvest.filter.${f.status}`),
      n: f.n,
      color: disabled ? DISABLED_COLOR : SHADES[f.status][shade],
      status: f.status,
      reason: f.reason_code,
      // Disabled skips sit last, out of the way of the real problems.
      order: disabled ? 100 : STATUS_ORDER.indexOf(f.status) * 10 + shade,
      disabled,
    });
  }
  ranked.sort((a, b) => a.order - b.order);
  slices.push(...ranked);
  if (other > 0) {
    slices.push({
      key: OTHER_KEY,
      label: t("harvest.pie.other"),
      n: other,
      color: OTHER_COLOR,
    });
  }
  return slices.filter((s) => s.n > 0);
}

const R = 30;
const C = 32;

function arcPath(start, end) {
  const point = (frac) => {
    const a = 2 * Math.PI * frac - Math.PI / 2;
    return `${C + R * Math.cos(a)} ${C + R * Math.sin(a)}`;
  };
  const large = end - start > 0.5 ? 1 : 0;
  return `M ${C} ${C} L ${point(start)} A ${R} ${R} 0 ${large} 1 ${point(end)} Z`;
}

const pct = (n, total) => `${Math.round((100 * n) / total)}%`;

// onSelect({status, reason}) makes slices and legend rows filter controls;
// `selected` is the slice key currently filtered on.
export default function HarvestPie({
  harvested,
  failures,
  shades,
  size = 64,
  onSelect,
  selected,
}) {
  const { t } = useTranslation();
  const slices = slicesFor(harvested, failures, shades, t);
  const total = slices.reduce((sum, s) => sum + s.n, 0);
  if (!total) return null;

  const selectable = (s) => onSelect && s.key !== OTHER_KEY;
  const select = (s) => selectable(s) && onSelect(s);
  const dimmed = (s) => selected && s.key !== selected;
  const tip = (s) => `${s.label}: ${s.n} (${pct(s.n, total)})`;

  let start = 0;
  return (
    <div className="harvest-pie">
      <svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        role="img"
        aria-label={t("harvest.pie.label", { harvested, total })}
      >
        {slices.length === 1 ? (
          <circle
            cx={C}
            cy={C}
            r={R}
            fill={slices[0].color}
            className={selectable(slices[0]) ? "harvest-clickable" : undefined}
            onClick={() => select(slices[0])}
          >
            <title>{tip(slices[0])}</title>
          </circle>
        ) : (
          slices.map((s) => {
            const end = start + s.n / total;
            const d = arcPath(start, end);
            start = end;
            return (
              <path
                key={s.key}
                d={d}
                fill={s.color}
                opacity={dimmed(s) ? 0.35 : 1}
                className={`harvest-pie-slice${selectable(s) ? " harvest-clickable" : ""}`}
                onClick={() => select(s)}
              >
                <title>{tip(s)}</title>
              </path>
            );
          })
        )}
      </svg>
      <ul className="harvest-pie-legend">
        {slices.map((s) => {
          const row = (
            <>
              <span
                className="harvest-pie-swatch"
                style={{ background: s.color }}
                aria-hidden="true"
              />
              <span className="harvest-pie-name" title={s.reason || s.label}>
                {s.label}
              </span>
              <span className="harvest-pie-value">
                {s.n} · {pct(s.n, total)}
              </span>
            </>
          );
          return (
            <li
              key={s.key}
              className={[
                dimmed(s) && "harvest-pie-dimmed",
                s.disabled && "harvest-pie-disabled",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {selectable(s) ? (
                <button
                  type="button"
                  className="harvest-pie-item"
                  aria-pressed={s.key === selected}
                  onClick={() => select(s)}
                >
                  {row}
                </button>
              ) : (
                row
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export const sliceKey = (status, reason) =>
  status === "success"
    ? "harvested"
    : failureKey({ status, reason_code: reason });
