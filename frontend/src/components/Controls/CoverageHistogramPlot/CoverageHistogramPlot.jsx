import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import './styles.css'

import Plotly from 'plotly.js-cartesian-dist-min'
import createPlotlyComponent from 'react-plotly.js/factory'
import frLocale from 'plotly.js-locales/fr'

import erddapServers from '../../../erddapServers.json'

Plotly.register(frLocale)
const Plot = createPlotlyComponent(Plotly)

// At most this many series get their own color; the rest fold into "Other".
const MAX_SERIES = 7

// Validated CVD-safe categorical palette (dataviz skill, light-surface slots
// 1–7, in the order that maximises adjacent separation). "Other" uses a
// neutral gray so it never impersonates a real series.
const SERIES_COLORS = [
  '#2a78d6', // blue
  '#008300', // green
  '#e87ba4', // magenta
  '#eda100', // yellow
  '#1baf7a', // aqua
  '#eb6834', // orange
  '#4a3aa7' // violet
]
const OTHER_COLOR = '#9a9a92'

const YEAR_MS = 365.25 * 24 * 3600 * 1000
const MONTH_MS = YEAR_MS / 12

const erddapLabels = new Map(
  erddapServers.map((s) => [s.url, { en: s.label_en, fr: s.label_fr }])
)

// Human label for a series key, by the kind the API tagged it with.
function seriesLabel (key, kind, language) {
  if (kind === 'erddap') {
    const entry = erddapLabels.get(key)
    if (entry) return language === 'fr' ? entry.fr : entry.en
    // Unknown server: show the host rather than the full URL.
    try {
      return new URL(key).hostname.replace(/^www\./, '')
    } catch {
      return key
    }
  }
  // OBIS nodes, platforms and data types are already display-ready.
  return key
}

// One label per time bin, sized to the bin width.
function formatPeriod (startMs, endMs, locale) {
  const start = new Date(startMs)
  const endInclusive = new Date(endMs - 1)
  const width = endMs - startMs
  if (width >= YEAR_MS - 24 * 3600 * 1000) {
    const y0 = start.getUTCFullYear()
    const y1 = endInclusive.getUTCFullYear()
    return y0 === y1 ? `${y0}` : `${y0}–${y1}`
  }
  const monthFormat = { month: 'short', year: 'numeric', timeZone: 'UTC' }
  if (width >= MONTH_MS - 24 * 3600 * 1000) {
    const m0 = start.toLocaleDateString(locale, monthFormat)
    const m1 = endInclusive.toLocaleDateString(locale, monthFormat)
    return m0 === m1 ? m0 : `${m0} – ${m1}`
  }
  const dayFormat = {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC'
  }
  const d0 = start.toLocaleDateString(locale, dayFormat)
  const d1 = endInclusive.toLocaleDateString(locale, dayFormat)
  return d0 === d1 ? d0 : `${d0} – ${d1}`
}

export default function CoverageHistogramPlot ({ histogram }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'fr' ? 'fr-CA' : 'en-CA'

  // Axis + hover wording follows what the bars count (datasets vs features).
  const countLabel =
    histogram.metric === 'features'
      ? t('coverageCountFeatures')
      : t('coverageCountDatasets')

  const { traces, periodLabels, binCenters, binWidths } = useMemo(() => {
    const { timeBinEdges, series, cells } = histogram
    const edgesMs = timeBinEdges.map((edge) => Date.parse(edge))
    const numBins = edgesMs.length - 1

    const centers = Array.from(
      { length: numBins },
      (_, i) => new Date((edgesMs[i] + edgesMs[i + 1]) / 2)
    )
    // Bar width per bin (ms), so contiguous bins tile the time axis.
    const widths = Array.from(
      { length: numBins },
      (_, i) => edgesMs[i + 1] - edgesMs[i]
    )
    const labels = Array.from({ length: numBins }, (_, i) =>
      formatPeriod(edgesMs[i], edgesMs[i + 1], locale)
    )

    // Top series keep their identity; everything past MAX_SERIES sums into a
    // single "Other" stack segment.
    const top = series.slice(0, MAX_SERIES)
    const counts = new Map(top.map((s) => [s.key, new Array(numBins).fill(0)]))
    const other = new Array(numBins).fill(0)
    let hasOther = series.length > MAX_SERIES

    cells.forEach(([binIndex, key, count]) => {
      const bucket = counts.get(key)
      if (bucket) bucket[binIndex - 1] += count
      else {
        other[binIndex - 1] += count
        hasOther = true
      }
    })

    // Stacking order = trace order; the largest series (first) sits at the
    // bottom of every bar.
    const built = top.map((s, index) => ({
      name: seriesLabel(s.key, s.kind, i18n.language),
      color: SERIES_COLORS[index % SERIES_COLORS.length],
      y: counts.get(s.key)
    }))
    if (hasOther) {
      built.push({ name: t('coverageOtherSeries'), color: OTHER_COLOR, y: other })
    }

    return {
      traces: built,
      periodLabels: labels,
      binCenters: centers,
      binWidths: widths
    }
  }, [histogram, locale, i18n.language, t])

  return (
    <div className='coverageHistogramPlot'>
      <Plot
        data={traces.map((trace) => ({
          type: 'bar',
          name: trace.name,
          x: binCenters,
          y: trace.y,
          width: binWidths,
          customdata: periodLabels,
          marker: {
            color: trace.color,
            // 1px surface-colored separator between stacked segments.
            line: { color: '#ffffff', width: 1 }
          },
          hovertemplate:
            `<b>${trace.name}</b><br>` +
            '%{customdata}<br>' +
            `${countLabel}: %{y}<extra></extra>`
        }))}
        layout={{
          barmode: 'stack',
          bargap: 0,
          autosize: true,
          font: {
            family: "'Montserrat', system-ui, sans-serif",
            color: '#152F37',
            size: 12
          },
          margin: { l: 8, r: 8, t: 8, b: 8 },
          xaxis: {
            automargin: true,
            showgrid: false,
            zeroline: false
          },
          yaxis: {
            automargin: true,
            title: { text: countLabel },
            gridcolor: '#DCE8E5',
            zeroline: false,
            rangemode: 'tozero'
          },
          // Horizontal legend beneath the plot: robust to the variable-length
          // series labels (e.g. platform names) and lets auto-margin reserve
          // its own row rather than overflowing a fixed right gutter.
          legend: {
            orientation: 'h',
            x: 0.5,
            xanchor: 'center',
            y: -0.14,
            yanchor: 'top',
            font: { size: 11 },
            title: { text: '' }
          },
          paper_bgcolor: 'rgba(0,0,0,0)',
          plot_bgcolor: 'rgba(0,0,0,0)',
          hovermode: 'closest',
          dragmode: false
        }}
        config={{
          displaylogo: false,
          modeBarButtonsToRemove: [
            'select2d',
            'lasso2d',
            'zoom2d',
            'pan2d',
            'zoomIn2d',
            'zoomOut2d',
            'autoScale2d',
            'resetScale2d'
          ],
          responsive: true,
          locale: i18n.language === 'fr' ? 'fr' : 'en'
        }}
        style={{ width: '100%', height: '100%' }}
        useResizeHandler
      />
    </div>
  )
}
