import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import "./styles.css";

import Plotly from "plotly.js-basic-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import frLocale from "plotly.js-locales/fr";

import erddapServers from "../../../erddapServers.json";
import { escapeHtml, formatErddapServerName } from "../../../utilities";
import useMediaQuery from "../../../state/ui/useMediaQuery.js";

Plotly.register(frLocale);
const Plot = createPlotlyComponent(Plotly);

// At most this many series get their own color; the rest fold into "Other".
const MAX_SERIES = 7;

// Validated CVD-safe categorical palette (dataviz skill, light-surface slots
// 1–7, in the order that maximises adjacent separation). "Other" uses a
// neutral gray so it never impersonates a real series.
const SERIES_COLORS = [
  "#2a78d6", // blue
  "#008300", // green
  "#e87ba4", // magenta
  "#eda100", // yellow
  "#1baf7a", // aqua
  "#eb6834", // orange
  "#4a3aa7", // violet
];
const OTHER_COLOR = "#9a9a92";

// Below the width at which the coverage dialog stops growing (1040px + its
// 24px gutter), bars get too thin for their white outlines: Plotly strokes
// every side, so the edges outweigh the fill.
const NARROW_QUERY = "(max-width: 1064px)";

const DAY_MS = 24 * 3600 * 1000;
const YEAR_MS = 365.25 * DAY_MS;
const MONTH_MS = YEAR_MS / 12;

// Human label for a series key, by the kind the API tagged it with. An erddap
// key is a server URL, which the rest of the app already knows how to name —
// and which can arrive null for a dataset with no erddap_url, so the shared
// helper's own null handling matters here. Source series carry their platform
// so an ERDDAP server and an OBIS node with similar names stay distinguishable.
function seriesLabel(key, kind, language) {
  if (kind === "erddap")
    return `${formatErddapServerName(key, language, erddapServers)} (ERDDAP)`;
  if (kind === "obis") return `${key} (OBIS)`;
  // Platforms, data types and organization names are already display-ready.
  return key;
}

// One label per time bin, sized to the bin width.
function formatPeriod(startMs, endMs, locale) {
  const start = new Date(startMs);
  const endInclusive = new Date(endMs - 1);
  const width = endMs - startMs;
  if (width >= YEAR_MS - DAY_MS) {
    // Bins are whole 365.25-day years, so an edge drifts hours either side of
    // Jan 1. Nudge past that before reading the opening year, then count the
    // years the bin spans — naming its far edge instead reads the year the
    // drift spills into, which overstated every span by one.
    const years = Math.max(1, Math.round(width / YEAR_MS));
    const y0 = new Date(startMs + DAY_MS).getUTCFullYear();
    const y1 = y0 + years - 1;
    return y0 === y1 ? `${y0}` : `${y0}–${y1}`;
  }
  const monthFormat = { month: "short", year: "numeric", timeZone: "UTC" };
  if (width >= MONTH_MS - 24 * 3600 * 1000) {
    const m0 = start.toLocaleDateString(locale, monthFormat);
    const m1 = endInclusive.toLocaleDateString(locale, monthFormat);
    return m0 === m1 ? m0 : `${m0} – ${m1}`;
  }
  const dayFormat = {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  };
  const d0 = start.toLocaleDateString(locale, dayFormat);
  const d1 = endInclusive.toLocaleDateString(locale, dayFormat);
  return d0 === d1 ? d0 : `${d0} – ${d1}`;
}

export default function CoverageHistogramPlot({ histogram }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "fr" ? "fr-CA" : "en-CA";
  const narrow = useMediaQuery(NARROW_QUERY);

  // Axis + hover wording follows what the bars count.
  const COUNT_LABELS = {
    features: "coverageCountFeatures",
    days: "coverageCountDays",
    datasets: "coverageCountDatasets",
  };
  const countLabel = t(COUNT_LABELS[histogram.count] || COUNT_LABELS.datasets);

  const { traces, binCenters, binWidths, legendSide } = useMemo(() => {
    const { timeBinEdges, series, cells } = histogram;
    const edgesMs = timeBinEdges.map((edge) => Date.parse(edge));
    const numBins = edgesMs.length - 1;

    const centers = Array.from(
      { length: numBins },
      (_, i) => new Date((edgesMs[i] + edgesMs[i + 1]) / 2),
    );
    // Bar width per bin (ms), so contiguous bins tile the time axis.
    const widths = Array.from(
      { length: numBins },
      (_, i) => edgesMs[i + 1] - edgesMs[i],
    );
    const labels = Array.from({ length: numBins }, (_, i) =>
      formatPeriod(edgesMs[i], edgesMs[i + 1], locale),
    );

    // Top series keep their identity; everything past MAX_SERIES sums into a
    // single "Other" stack segment.
    const top = series.slice(0, MAX_SERIES);
    const counts = new Map(top.map((s) => [s.key, new Array(numBins).fill(0)]));
    const other = new Array(numBins).fill(0);
    let hasOther = series.length > MAX_SERIES;

    cells.forEach(([binIndex, key, count]) => {
      const bucket = counts.get(key);
      if (bucket) bucket[binIndex - 1] += count;
      else {
        other[binIndex - 1] += count;
        hasOther = true;
      }
    });

    // Stacking order = trace order; the largest series (first) sits at the
    // bottom of every bar.
    const built = top.map((s, index) => ({
      name: seriesLabel(s.key, s.kind, i18n.language),
      color: SERIES_COLORS[index % SERIES_COLORS.length],
      y: counts.get(s.key),
    }));
    if (hasOther) {
      built.push({
        name: t("coverageOtherSeries"),
        color: OTHER_COLOR,
        y: other,
      });
    }

    // The legend floats over the plot, so seat it on whichever end the bars
    // leave emptiest. Only the outer third of each end matters: that is the
    // width the keys occupy, and a stacked time histogram is nearly always
    // lopsided (recent bins dwarf old ones).
    const totals = new Array(numBins).fill(0);
    built.forEach(({ y }) => y.forEach((value, i) => (totals[i] += value)));
    const peak = (values) => values.reduce((max, v) => Math.max(max, v), 0);
    const end = Math.max(1, Math.round(numBins / 3));
    const side =
      peak(totals.slice(0, end)) <= peak(totals.slice(-end)) ? "left" : "right";

    // Hovering any segment describes the whole bar: its period, total and
    // every series in it, listed top-down to match the stack, with the
    // hovered one in bold. Names are harvested strings and Plotly parses the
    // label as HTML, so they're escaped.
    const format = (n) => n.toLocaleString(locale);
    const hoverText = built.map((_, hovered) =>
      labels.map((label, bin) => {
        const rows = built
          .map(({ name, color, y }, index) => ({
            name,
            color,
            index,
            count: y[bin],
          }))
          .filter(({ count }) => count > 0)
          .reverse()
          .map(({ name, color, index, count }) => {
            const row = `<span style="color:${color}">■</span> ${escapeHtml(name)}: ${format(count)}`;
            return index === hovered ? `<b>${row}</b>` : row;
          });
        return (
          `<b>${label}</b><br>` +
          `${countLabel}: ${format(totals[bin])}<br>` +
          rows.join("<br>")
        );
      }),
    );

    return {
      traces: built.map((trace, index) => ({
        ...trace,
        hoverText: hoverText[index],
      })),
      binCenters: centers,
      binWidths: widths,
      legendSide: side,
    };
  }, [histogram, locale, i18n.language, t, countLabel]);

  return (
    <div className="coverageHistogramPlot">
      <Plot
        data={traces.map((trace) => ({
          type: "bar",
          name: trace.name,
          x: binCenters,
          y: trace.y,
          width: binWidths,
          marker: {
            color: trace.color,
            line: { color: "#ffffff", width: narrow ? 0 : 1 },
          },
          customdata: trace.hoverText,
          hovertemplate: "%{customdata}<extra></extra>",
        }))}
        layout={{
          barmode: "stack",
          bargap: 0,
          autosize: true,
          font: {
            family: "'Montserrat', system-ui, sans-serif",
            color: "#152F37",
            size: 12,
          },
          margin: { l: 8, r: 8, t: 8, b: 8 },
          xaxis: {
            automargin: true,
            showgrid: false,
            zeroline: false,
            // Baseline the bars sit on: ink-40, so it reads as structure
            // rather than dissolving into the gridlines behind it.
            showline: true,
            linecolor: "rgba(21, 47, 55, 0.4)",
            linewidth: 1,
          },
          yaxis: {
            automargin: true,
            title: { text: countLabel },
            gridcolor: "#DCE8E5",
            zeroline: false,
            rangemode: "tozero",
          },
          // Floated in whichever top corner the bars leave emptiest, inset off
          // the axes, so the plot keeps the whole container. Draggable from
          // there (see config.edits) when the guess lands badly.
          legend: {
            x: legendSide === "left" ? 0.02 : 0.98,
            xanchor: legendSide === "left" ? "left" : "right",
            y: 0.98,
            yanchor: "top",
            bgcolor: "#ffffff",
            bordercolor: "#DCE8E5",
            borderwidth: 1,
            font: { size: 11 },
            title: { text: "" },
          },
          paper_bgcolor: "rgba(0,0,0,0)",
          plot_bgcolor: "rgba(0,0,0,0)",
          hovermode: "closest",
          hoverlabel: {
            bgcolor: "#ffffff",
            bordercolor: "#DCE8E5",
            font: { color: "#152F37" },
            align: "left",
          },
          dragmode: false,
        }}
        config={{
          displaylogo: false,
          // Legend dragging only — not Plotly's full editable mode, which
          // would also make titles and axis labels click-to-edit.
          edits: { legendPosition: true },
          modeBarButtonsToRemove: [
            "select2d",
            "lasso2d",
            "zoom2d",
            "pan2d",
            "zoomIn2d",
            "zoomOut2d",
            "autoScale2d",
            "resetScale2d",
          ],
          responsive: true,
          locale: i18n.language === "fr" ? "fr" : "en",
        }}
        style={{ width: "100%", height: "100%" }}
        useResizeHandler
      />
    </div>
  );
}
