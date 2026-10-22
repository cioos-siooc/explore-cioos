import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import "./styles.css";

import Plotly from "plotly.js-basic-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import frLocale from "plotly.js-locales/fr";

import erddapServers from "../../../erddapServers.json";
import platformColors from "../../platformColors";
import { escapeHtml, formatErddapServerName } from "../../../utilities";
import { cdmDataTypeLabel } from "../../../state/dataLayers.js";
import useElementSize from "../../ui/useElementSize.js";

Plotly.register(frLocale);
const Plot = createPlotlyComponent(Plotly);

const MAX_SERIES = 7;

// Order is validated for adjacent-pair colour-blind contrast (not all-pair) —
// don't reshuffle. Avoids the map's reserved hues (track, grid, click, error).
const SERIES_COLORS = [
  "#008b7d",
  "#53b6eb",
  "#b83b76",
  "#85b749",
  "#2b519c",
  "#be753f",
  "#e398ca",
];
const OTHER_COLOR = "#a7b8bc";

// Thinner bars lose their white outlines: Plotly strokes every side, so the
// edges outweigh the fill. Judged per bar, as the figure's width and bin count
// both vary.
const MIN_OUTLINED_BAR_PX = 6;

const DAY_MS = 24 * 3600 * 1000;
const YEAR_MS = 365.25 * DAY_MS;
const MONTH_MS = YEAR_MS / 12;

// An erddap key can be null (dataset with no erddap_url); the shared helper
// handles that.
function seriesLabel(key, kind, language, t) {
  if (kind === "erddap")
    return `${formatErddapServerName(key, language, erddapServers)} (ERDDAP)`;
  if (kind === "obis") return `${key} (OBIS)`;
  if (kind === "dataType") return cdmDataTypeLabel(key, t);
  return key;
}

// Seasonal bins are weeks of a reference year whose year means nothing.
function formatPeriod(startMs, endMs, locale, seasonal) {
  const start = new Date(startMs);
  const endInclusive = new Date(endMs - 1);
  const width = endMs - startMs;
  if (seasonal) {
    const weekFormat = { day: "numeric", month: "short", timeZone: "UTC" };
    return `${start.toLocaleDateString(locale, weekFormat)} – ${endInclusive.toLocaleDateString(locale, weekFormat)}`;
  }
  if (width >= YEAR_MS - DAY_MS) {
    // 365.25-day bins drift hours around Jan 1: nudge before reading the
    // opening year and count spanned years (the far edge overstates by one).
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
  const [plotRef, { width: plotWidth }] = useElementSize();

  const COUNT_LABELS = {
    features: "coverageCountFeatures",
    days: "coverageCountDays",
    datasets: "coverageCountDatasets",
  };
  const countLabel = t(COUNT_LABELS[histogram.count] || COUNT_LABELS.datasets);
  const seasonal = histogram.view === "seasonal";

  const { traces, binCenters, binWidths, legendSide } = useMemo(() => {
    const { timeBinEdges, series, cells } = histogram;
    const edgesMs = timeBinEdges.map((edge) => Date.parse(edge));
    const numBins = edgesMs.length - 1;

    const centers = Array.from(
      { length: numBins },
      (_, i) => new Date((edgesMs[i] + edgesMs[i + 1]) / 2),
    );
    const widths = Array.from(
      { length: numBins },
      (_, i) => edgesMs[i + 1] - edgesMs[i],
    );
    const labels = Array.from({ length: numBins }, (_, i) =>
      formatPeriod(edgesMs[i], edgesMs[i + 1], locale, seasonal),
    );

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

    const platformColor = (s) =>
      s.kind === "platform" &&
      platformColors.find(({ platform }) => platform === s.key)?.color;
    let nextSlot = 0;
    const built = top.map((s) => ({
      name: seriesLabel(s.key, s.kind, i18n.language, t),
      color: platformColor(s) || SERIES_COLORS[nextSlot++],
      y: counts.get(s.key),
    }));
    if (hasOther) {
      built.push({
        name: t("coverageOtherSeries"),
        color: OTHER_COLOR,
        y: other,
      });
    }

    // The floating legend sits over whichever outer third the bars leave
    // emptiest.
    const totals = new Array(numBins).fill(0);
    built.forEach(({ y }) => y.forEach((value, i) => (totals[i] += value)));
    const peak = (values) => values.reduce((max, v) => Math.max(max, v), 0);
    const end = Math.max(1, Math.round(numBins / 3));
    const side =
      peak(totals.slice(0, end)) <= peak(totals.slice(-end)) ? "left" : "right";

    // Plotly parses hover labels as HTML and names are harvested strings, so
    // they're escaped.
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
  }, [histogram, locale, i18n.language, t, countLabel, seasonal]);

  const outlined = plotWidth / binCenters.length >= MIN_OUTLINED_BAR_PX;

  return (
    <div className="coverageHistogramPlot" ref={plotRef}>
      <Plot
        data={traces.map((trace) => ({
          type: "bar",
          name: trace.name,
          x: binCenters,
          y: trace.y,
          width: binWidths,
          marker: {
            color: trace.color,
            line: { color: "#ffffff", width: outlined ? 1 : 0 },
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
            showline: true,
            linecolor: "rgba(21, 47, 55, 0.4)",
            linewidth: 1,
            ...(seasonal && { tickformat: "%b", dtick: "M1" }),
          },
          yaxis: {
            automargin: true,
            title: { text: countLabel },
            gridcolor: "#DCE8E5",
            zeroline: false,
            rangemode: "tozero",
          },
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
          // Plotly 4 defaults this on; it posts the chart to cloud.plotly.com.
          showSendToCloud: false,
          // Not `editable: true`, which would make titles click-to-edit too.
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
