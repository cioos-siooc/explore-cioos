import { test } from 'node:test'
import assert from 'node:assert/strict'

import { variablesFrom, byColumnName } from './previewVariables.js'
import { facetPlanFor, COLUMNS, ROWS } from './previewFacetPlan.js'
import {
  buildFigure,
  domainsFor,
  plotHeightFor,
  plotWidthFor,
  panelColorFor,
  MIN_PANEL_PX
} from './previewFacetFigure.js'
import { VIKING, VIKING_DATASET } from './previewVariables.test.mjs'

const ALL_SIX = ['TE90_01', 'CNDC_01', 'PRES_01', 'PSAL_01', 'FLOR_01', 'DOXY_01']

const DATA = Array.from({ length: 20 }, (_, i) => {
  const row = { depth: i + 1, time: `2025-09-16T00:${String(i).padStart(2, '0')}:00Z` }
  ALL_SIX.forEach((name, n) => { row[name] = i * (n + 1) })
  return row
})

function figure (type, panels, extra = {}) {
  const dataset = { ...VIKING_DATASET, cdm_data_type: type }
  const variables = variablesFrom(VIKING, dataset)
  const plan = facetPlanFor(dataset, variables, DATA)
  return buildFigure({
    plan,
    variablesByName: byColumnName(variables),
    panels,
    sharedAxis: plan.sharedAxis,
    data: DATA,
    colorBy: null,
    colorscale: 'Viridis',
    mode: 'markers',
    uirevision: 'test',
    ...extra
  })
}

// --- domain arithmetic -------------------------------------------------------

test('one panel fills the plotting area', () => {
  assert.deepEqual(domainsFor(1, 0.05), [[0, 1]])
})

test('domains are ordered, non-overlapping and inside 0..1', () => {
  for (const n of [1, 2, 3, 4, 5, 6, 14]) {
    const domains = domainsFor(n, 0.05)
    assert.equal(domains.length, n, `n=${n}`)
    assert.equal(domains[0][0], 0, `n=${n} starts at 0`)
    assert.equal(domains[n - 1][1], 1, `n=${n} ends at 1`)
    domains.forEach(([start, end], i) => {
      assert.ok(end > start, `n=${n} panel ${i} has width`)
      assert.ok(start >= 0 && end <= 1, `n=${n} panel ${i} inside 0..1`)
      if (i) assert.ok(start > domains[i - 1][1], `n=${n} panel ${i} clears ${i - 1}`)
    })
  }
})

test('domains carry no float drift past 1', () => {
  // Plotly rejects a domain whose end lands at 1.0000000000000002.
  for (const n of [3, 6, 7, 9, 11, 13]) {
    assert.ok(domainsFor(n, 0.055)[n - 1][1] <= 1, `n=${n}`)
  }
})

test('no panels means no domains', () => {
  assert.deepEqual(domainsFor(0, 0.05), [])
})

// --- sizing -----------------------------------------------------------------

test('profile height is constant in panel count — panels share one depth axis', () => {
  const heights = [1, 2, 3, 6, 14].map((n) => plotHeightFor(COLUMNS, n, 600))
  assert.deepEqual(heights, [600, 600, 600, 600, 600])
})

test('stacked height grows with panel count, never below the space available', () => {
  assert.equal(plotHeightFor(ROWS, 1, 600), 600)
  const six = plotHeightFor(ROWS, 6, 600)
  assert.ok(six >= 6 * MIN_PANEL_PX, `${six} fits six ${MIN_PANEL_PX}px panels`)
  const heights = [1, 2, 3, 4, 5, 6].map((n) => plotHeightFor(ROWS, n, 600))
  for (let i = 1; i < heights.length; i += 1) {
    assert.ok(heights[i] >= heights[i - 1], 'monotonic in n')
  }
})

test('a collapsed container still gets a usable height', () => {
  // This is the first-render case: the measured height is 0 until the modal
  // lays out, and Plotly used to silently fall back to its own 450px default.
  assert.ok(plotHeightFor(COLUMNS, 1, 0) > 0)
  assert.ok(plotHeightFor(ROWS, 1, undefined) > 0)
})

test('profile width grows past the container once panels hit their floor', () => {
  assert.equal(plotWidthFor(COLUMNS, 2, 1000, false), 1000)
  assert.ok(plotWidthFor(COLUMNS, 14, 1000, false) > 1000)
  // Stacked panels never widen — they share one x axis.
  assert.equal(plotWidthFor(ROWS, 14, 1000, false), 1000)
})

test('colouring reserves gutter width', () => {
  assert.ok(
    plotWidthFor(COLUMNS, 8, 400, true) > plotWidthFor(COLUMNS, 8, 400, false)
  )
})

// --- profile layout (COLUMNS) ------------------------------------------------

test('a profile gets one shared y axis and one x axis per panel', () => {
  const { data, layout } = figure('TimeSeriesProfile', ALL_SIX)
  assert.equal(data.length, 6)
  assert.equal(Object.keys(layout).filter((k) => /^yaxis/.test(k)).length, 1)
  assert.equal(Object.keys(layout).filter((k) => /^xaxis/.test(k)).length, 6)
})

test('the shared depth axis is reversed and titled once', () => {
  const { layout } = figure('TimeSeriesProfile', ALL_SIX)
  assert.equal(layout.yaxis.autorange, 'reversed')
  assert.equal(layout.yaxis.title.text, 'depth of observation ( m )')
})

test('profile panel titles sit on top, one per variable', () => {
  const { layout } = figure('TimeSeriesProfile', ['TE90_01', 'PSAL_01'])
  assert.equal(layout.xaxis.side, 'top')
  assert.equal(layout.xaxis.title.text, 'Temperature (1990 scale) ( degree_C )')
  assert.equal(layout.xaxis2.side, 'top')
  assert.equal(layout.xaxis2.title.text, 'Practical Salinity ( PSU )')
})

test('every profile trace shares y and takes its own x', () => {
  const { data } = figure('TimeSeriesProfile', ALL_SIX)
  assert.deepEqual(data.map((t) => t.yaxis), Array(6).fill('y'))
  assert.deepEqual(data.map((t) => t.xaxis), ['x', 'x2', 'x3', 'x4', 'x5', 'x6'])
})

test('a profile puts the variable across and depth down', () => {
  const { data } = figure('TimeSeriesProfile', ['TE90_01'])
  assert.deepEqual(data[0].x, DATA.map((r) => r.TE90_01))
  assert.deepEqual(data[0].y, DATA.map((r) => r.depth))
})

// --- timeseries layout (ROWS) -----------------------------------------------

test('a timeseries gets one shared x axis and one y axis per panel', () => {
  const { data, layout } = figure('TimeSeries', ALL_SIX)
  assert.equal(data.length, 6)
  assert.equal(Object.keys(layout).filter((k) => /^xaxis/.test(k)).length, 1)
  assert.equal(Object.keys(layout).filter((k) => /^yaxis/.test(k)).length, 6)
})

test('every timeseries trace shares x and takes its own y', () => {
  const { data } = figure('TimeSeries', ALL_SIX)
  assert.deepEqual(data.map((t) => t.xaxis), Array(6).fill('x'))
  assert.deepEqual(data.map((t) => t.yaxis), ['y', 'y2', 'y3', 'y4', 'y5', 'y6'])
})

test('the first selected variable is drawn at the bottom', () => {
  // The image stacks Variable 1 lowest; the domain order therefore runs opposite
  // to the panel order.
  const { layout } = figure('TimeSeries', ['TE90_01', 'PSAL_01', 'DOXY_01'])
  assert.ok(layout.yaxis.domain[0] < layout.yaxis3.domain[0])
  assert.equal(layout.yaxis.title.text, 'Temperature (1990 scale) ( degree_C )')
})

test('a timeseries puts time across and the variable up', () => {
  const { data } = figure('TimeSeries', ['TE90_01'])
  assert.deepEqual(data[0].x, DATA.map((r) => r.time))
  assert.deepEqual(data[0].y, DATA.map((r) => r.TE90_01))
})

// --- shared behaviour -------------------------------------------------------

test('one variable is a single panel filling the area, not a special case', () => {
  const { data, layout } = figure('TimeSeriesProfile', ['TE90_01'])
  assert.equal(data.length, 1)
  assert.deepEqual(layout.xaxis.domain, [0, 1])
  assert.equal(layout.yaxis.domain[0], 0)
})

test('panels get distinct colours', () => {
  const { data } = figure('TimeSeriesProfile', ALL_SIX)
  const colors = data.map((t) => t.marker.color)
  assert.equal(new Set(colors).size, 6)
  assert.equal(colors[0], panelColorFor(0))
})

test('the legend is off — each panel is already titled', () => {
  assert.equal(figure('TimeSeriesProfile', ALL_SIX).layout.showlegend, false)
})

test('explicit width and height are passed through, replacing autosize', () => {
  const { layout } = figure('TimeSeriesProfile', ALL_SIX,
    { size: { width: 900, height: 640 } })
  assert.equal(layout.width, 900)
  assert.equal(layout.height, 640)
  assert.ok(!('autosize' in layout))
})

test('uirevision is carried so a changed axis set does not restore a stale zoom', () => {
  assert.equal(figure('TimeSeriesProfile', ALL_SIX,
    { uirevision: 'rec|depth|a,b' }).layout.uirevision, 'rec|depth|a,b')
})

// --- colour dimension -------------------------------------------------------

test('colouring draws exactly one colourbar across all panels', () => {
  const { data } = figure('TimeSeriesProfile', ALL_SIX, { colorBy: 'PSAL_01' })
  assert.deepEqual(data.map((t) => t.marker.showscale),
    [true, false, false, false, false, false])
  assert.equal(data.filter((t) => t.marker.colorbar).length, 1)
})

test('colour range prefers the declared colorBar bounds over the data', () => {
  // TE90_01 declares -10..40 and an actual_range topping 191277 — the data
  // range would be right here, but the declared bounds are what publishers mean.
  const { data } = figure('TimeSeriesProfile', ['PSAL_01'], { colorBy: 'TE90_01' })
  assert.equal(data[0].marker.cmin, -10)
  assert.equal(data[0].marker.cmax, 40)
})

test('colour range falls back to the data when nothing is declared', () => {
  const { data } = figure('TimeSeriesProfile', ['TE90_01'], { colorBy: 'CNDC_01' })
  assert.equal(data[0].marker.cmin, 0)
  assert.equal(data[0].marker.cmax, 19 * 2)
})

test('lines-only mode gains markers when colouring is on', () => {
  // A colour value has nothing to render on without a marker.
  const { data } = figure('TimeSeriesProfile', ['TE90_01'],
    { colorBy: 'PSAL_01', mode: 'lines' })
  assert.equal(data[0].mode, 'markers+lines')
  const plain = figure('TimeSeriesProfile', ['TE90_01'], { mode: 'lines' })
  assert.equal(plain.data[0].mode, 'lines')
})

test('a custom label replaces the name but keeps the unit', () => {
  const { layout } = figure('TimeSeriesProfile', ['TE90_01'],
    { labels: { TE90_01: 'Temp' } })
  assert.equal(layout.xaxis.title.text, 'Temp ( degree_C )')
})

test('no rows yet still produces the full axis skeleton', () => {
  const dataset = { ...VIKING_DATASET, cdm_data_type: 'TimeSeriesProfile' }
  const variables = variablesFrom(VIKING, dataset)
  const plan = facetPlanFor(dataset, variables, undefined)
  const { data, layout } = buildFigure({
    plan,
    variablesByName: byColumnName(variables),
    panels: ['TE90_01', 'PSAL_01'],
    sharedAxis: 'depth',
    data: undefined,
    colorscale: 'Viridis',
    uirevision: 'x'
  })
  assert.equal(data.length, 2)
  assert.deepEqual(data[0].x, [])
  assert.equal(layout.xaxis2.title.text, 'Practical Salinity ( PSU )')
})
