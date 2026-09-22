import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import Plotly from "plotly.js-basic-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import frLocale from "plotly.js-locales/fr";

Plotly.register(frLocale);
const Plot = createPlotlyComponent(Plotly);

/**
 * Two-ring donut: how much of what CDE's sources offer actually reaches the
 * app. Plotly has no native nested-donut trace in the already-chunked
 * plotly.js-basic-dist-min bundle (bar + pie only — sunburst would need its
 * own build, which fights this project's manual Vite chunking keyed to that
 * package name), so each ring is its own "pie" trace instead: ring 1
 * (integrated vs not) is drawn at full size with a hole, ring 2 (broken down
 * by source) is shrunk via `domain` until its edge lands short of ring 1's
 * hole, leaving a gap so the two levels read as levels rather than one thick
 * band.
 *
 * Colours mirror the --harvest-viz-* tokens in styles.css (ΔE-checked
 * against the sand surface there) — Plotly needs literal colour strings, so
 * VIZ_COLORS must be kept in sync with that file by hand.
 */

const SIZE = 260;
const VIZ_COLORS = {
  "--harvest-viz-integrated": "#1f6f7a",
  "--harvest-viz-gap": "#b8c4c2",
  "--harvest-viz-erddap": "#2a78d6",
  "--harvest-viz-erddap-soft": "#9ec5f4",
  "--harvest-viz-obis": "#eb6834",
  "--harvest-viz-obis-soft": "#f7bfa6",
  "--harvest-viz-ckan": "#4a3aa7",
  "--harvest-viz-ckan-soft": "#bfb7e8",
};

// Each ring's inner/outer radius as a fraction of the figure's max radius.
const RING_GEOMETRY = [
  { inner: 0.4, outer: 0.66 }, // ring 1: integrated vs not
  { inner: 0.72, outer: 1 }, // ring 2: broken down by source
];

function pct(value, total) {
  if (!total) return "0%";
  const p = (value / total) * 100;
  return `${p >= 10 || p === 0 ? Math.round(p) : p.toFixed(1)}%`;
}

function ringTrace(segments, geometry) {
  const pad = (1 - geometry.outer) / 2;
  return {
    type: "pie",
    values: segments.map((s) => s.value),
    labels: segments.map((s) => s.label),
    marker: { colors: segments.map((s) => VIZ_COLORS[s.color] || s.color) },
    domain: { x: [pad, 1 - pad], y: [pad, 1 - pad] },
    hole: geometry.inner / geometry.outer,
    sort: false,
    textinfo: "none",
    hoverinfo: "label+value+percent",
    showlegend: false,
  };
}

export default function CoverageDonut({
  rings,
  total,
  caption,
  hint,
  centerLabel,
}) {
  const { i18n } = useTranslation();

  const integratedPct = pct(rings[0][0]?.value || 0, total);
  const data = useMemo(
    () => rings.map((segments, i) => ringTrace(segments, RING_GEOMETRY[i])),
    [rings],
  );

  return (
    <figure className="harvest-viz">
      <div className="harvest-viz-figure">
        <div className="harvest-viz-plot-wrap">
          {/* Decorative: the center value/label and the legend below are
              plain HTML carrying the same numbers, which is the accessible
              description — nothing here rests on the canvas-drawn arcs. */}
          <div aria-hidden="true">
            <Plot
              data={data}
              layout={{
                width: SIZE,
                height: SIZE,
                margin: { l: 0, r: 0, t: 0, b: 0 },
                showlegend: false,
                paper_bgcolor: "rgba(0,0,0,0)",
                plot_bgcolor: "rgba(0,0,0,0)",
              }}
              config={{
                displayModeBar: false,
                responsive: false,
                locale: i18n.language === "fr" ? "fr" : "en",
              }}
            />
          </div>
          <div className="harvest-viz-center">
            <div className="harvest-viz-center-value">{integratedPct}</div>
            <div className="harvest-viz-center-label">{centerLabel}</div>
          </div>
        </div>
        <p className="harvest-viz-hint harvest-muted harvest-text-sm">{hint}</p>
      </div>

      {/* Identity never rests on colour: every segment is named here, and the
          same numbers appear in the table below the chart. */}
      <ul className="harvest-viz-legend">
        {rings.flat().map((seg) => (
          <li key={seg.key} className="harvest-viz-legend-item">
            <span
              className="harvest-viz-swatch"
              style={{ background: VIZ_COLORS[seg.color] || seg.color }}
            />
            <span className="harvest-viz-legend-label">{seg.label}</span>
            <span className="harvest-viz-legend-value">
              {seg.value.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>

      <figcaption className="harvest-viz-caption harvest-muted harvest-text-sm">
        {caption}
      </figcaption>
    </figure>
  );
}
