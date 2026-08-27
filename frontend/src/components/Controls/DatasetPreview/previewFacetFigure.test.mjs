import { test } from 'node:test'
import assert from 'node:assert/strict'

import { variablesFrom, byColumnName } from './previewVariables.js'
import { facetPlanFor, COLUMNS, ROWS } from './previewFacetPlan.js'
import {
  buildFigure,
  domainsFor,
  plotHeightFor,
  plotWidthFor,
  marginFor,
  maxCharsFor,
  LABEL_GUTTER_PX,
  panelPitch,
  recordTitleFor,
  titleLinesFor,
  titleRoomFor,
  wrapTitleFor,
  MAX_TITLE_LINES,
  TITLE_FONT_PX,
  wrapLabel,
  MIN_PANEL_PX,
  LABEL_FONT_PX
} from './previewFacetFigure.js'
import { defaultColorFor } from './previewColors.js'
import { paletteColorFor } from './erddapPalettes.js'
import {
  VIKING,
  VIKING_NO_META,
  VIKING_DATASET
} from './previewVariables.test.mjs'

const ALL_SIX = ['TE90_01', 'CNDC_01', 'PRES_01', 'PSAL_01', 'FLOR_01', 'DOXY_01']

// The two cf_role columns carry values, because they are what the figure is
// titled after — the station the user clicked, and the profile actually drawn.
const DATA = Array.from({ length: 20 }, (_, i) => {
  const row = {
    station_id: 'PMZA-RIKI',
    profile: 'PMZA-RIKI-25/09/16-17:35:26',
    depth: i + 1,
    time: `2025-09-16T00:${String(i).padStart(2, '0')}:00Z`
  }
  ALL_SIX.forEach((name, n) => { row[name] = i * (n + 1) })
  return row
})

const TITLE = 'Station Id: PMZA-RIKI — Profile: PMZA-RIKI-25/09/16-17:35:26'

// Same dataset with the publisher's palettes declared on two measurements, to
// exercise the colour default that comes from ERDDAP rather than from an index.
const VIKING_PALETTES = {
  ...VIKING,
  columnMeta: VIKING.columnMeta.map((meta) => {
    if (meta.name === 'TE90_01') return { ...meta, colorBarPalette: 'KT_thermal' }
    if (meta.name === 'PSAL_01') return { ...meta, colorBarPalette: 'KT_haline' }
    return meta
  })
}

function figureFrom (table, type, panels, extra = {}) {
  const dataset = { ...VIKING_DATASET, cdm_data_type: type }
  const variables = variablesFrom(table, dataset)
  const variablesByName = byColumnName(variables)
  const plan = facetPlanFor(dataset, variables, DATA)
  return buildFigure({
    plan,
    variablesByName,
    panels,
    sharedAxis: plan.sharedAxis,
    data: DATA,
    title: recordTitleFor({ plan, variablesByName, data: DATA }),
    mode: 'markers',
    uirevision: 'test',
    ...extra
  })
}

const figure = (type, panels, extra) => figureFrom(VIKING, type, panels, extra)

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
  assert.equal(plotWidthFor(COLUMNS, 2, 1000), 1000)
  assert.ok(plotWidthFor(COLUMNS, 14, 1000) > 1000)
  // Stacked panels never widen — they share one x axis.
  assert.equal(plotWidthFor(ROWS, 14, 1000), 1000)
})

// --- profile layout (COLUMNS) ------------------------------------------------

test('a profile gets one shared y axis and one x axis per panel', () => {
  const { data, layout } = figure('TimeSeriesProfile', ALL_SIX)
  assert.equal(data.length, 6)
  assert.equal(Object.keys(layout).filter((k) => /^yaxis/.test(k)).length, 1)
  assert.equal(Object.keys(layout).filter((k) => /^xaxis/.test(k)).length, 6)
})

test('the shared depth axis is reversed, and labelled horizontally beside itself', () => {
  const { layout } = figure('TimeSeriesProfile', ALL_SIX)
  assert.equal(layout.yaxis.autorange, 'reversed')
  // NOT an axis title: this Plotly has no angle on one, so it would be drawn
  // sideways. An annotation in the same place instead — beside the axis, centred
  // on the span it labels.
  assert.ok(!layout.yaxis.title)
  assert.equal(layout.annotations.length, 1)
  const label = layout.annotations[0]
  assert.equal(label.text.replace(/<br>/g, ' '), 'depth of observation ( m )')
  assert.equal(label.y, 0.5)
  assert.equal(label.yanchor, 'middle')
  // Left of the axis line and clear of its tick labels.
  assert.equal(label.xanchor, 'right')
  assert.ok(label.xshift < 0)
  assert.equal(label.showarrow, false)
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
  assert.equal(
    layout.annotations[0].text.replace(/<br>/g, ' '),
    'Temperature (1990 scale) ( degree_C )'
  )
  const [low, high] = layout.yaxis.domain
  assert.equal(layout.annotations[0].y, (low + high) / 2)
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
    uirevision: 'x'
  })
  assert.equal(data.length, 2)
  assert.deepEqual(data[0].x, [])
  assert.equal(layout.xaxis2.title.text, 'Practical Salinity ( PSU )')
})

// --- labels read horizontally, whatever the orientation ----------------------

test('every stacked panel is labelled along its own axis, never rotated', () => {
  const { layout } = figure('TimeSeries', ALL_SIX)
  assert.equal(layout.annotations.length, ALL_SIX.length)
  for (let index = 0; index < ALL_SIX.length; index += 1) {
    const key = index === 0 ? 'yaxis' : `yaxis${index + 1}`
    // A y axis title is the one label Plotly insists on rotating, so no panel
    // axis carries one.
    assert.ok(!layout[key].title, `${key} has no title`)
    const [low, high] = layout[key].domain
    const annotation = layout.annotations[index]
    // Where the axis title would have been: centred on the axis it labels, and
    // to the left of it.
    assert.equal(annotation.y, (low + high) / 2, `${key} label is centred on it`)
    assert.equal(annotation.yanchor, 'middle')
    assert.equal(annotation.xanchor, 'right')
    assert.equal(annotation.x, 0)
    assert.ok(annotation.xshift < 0)
    assert.equal(annotation.font.size, LABEL_FONT_PX)
  }
})

test('a vertical axis label wraps into the gutter the margin reserves', () => {
  // The gutter is a constant, so unlike a panel title this wraps even on the
  // first render, before anything has been measured.
  const { layout } = figure('TimeSeries', ALL_SIX)
  const fits = maxCharsFor(LABEL_GUTTER_PX)
  layout.annotations.forEach((annotation) => {
    annotation.text.split('<br>').forEach((line) => {
      assert.ok(line.length <= fits, `"${line}" (${line.length} > ${fits})`)
    })
  })
  // Long enough to need it: this one does not fit on one line.
  assert.ok(layout.annotations[1].text.includes('<br>'), layout.annotations[1].text)
  const margin = marginFor(ROWS)
  assert.ok(
    margin.l >= LABEL_GUTTER_PX,
    `left margin ${margin.l} holds a ${LABEL_GUTTER_PX}px gutter`
  )
})

test('a stack keeps its shared axis title — that one is already horizontal', () => {
  const { layout } = figure('TimeSeries', ['TE90_01'])
  assert.equal(layout.xaxis.title.text, 'Time ( UTC )')
  assert.equal(layout.xaxis.title.font.size, LABEL_FONT_PX)
})

test('a profile labels only the shared axis by annotation', () => {
  // Panel titles there are x titles on top, which Plotly already draws
  // horizontally — so they stay axis titles and keep automargin.
  const { layout } = figure('TimeSeriesProfile', ALL_SIX)
  assert.equal(layout.annotations.length, 1)
  assert.equal(layout.xaxis.side, 'top')
  assert.ok(layout.xaxis.title.text)
})

test('every label is drawn at the size the wrap estimate assumes', () => {
  const { layout } = figure('TimeSeriesProfile', ALL_SIX)
  assert.equal(layout.font.size, LABEL_FONT_PX)
  assert.equal(layout.xaxis.title.font.size, LABEL_FONT_PX)
  assert.equal(layout.annotations[0].font.size, LABEL_FONT_PX)
})

// --- wrapping ----------------------------------------------------------------

test('a label that fits is left alone', () => {
  assert.equal(wrapLabel('Depth ( m )', 40), 'Depth ( m )')
})

test('the unit goes on its own line first', () => {
  assert.equal(
    wrapLabel('Practical Salinity ( PSU )', 20),
    'Practical Salinity<br>( PSU )'
  )
})

test('a long name wraps at word boundaries, never mid-word', () => {
  const wrapped = wrapLabel('Mass concentration of chlorophyll ( mg m-3 )', 22)
  wrapped.split('<br>').forEach((line) => {
    assert.ok(line.length <= 22 || !line.includes(' '), line)
  })
  assert.ok(!wrapped.includes('chloro<br>'))
})

test('past the line cap the name is truncated and the unit survives', () => {
  const wrapped = wrapLabel(
    'Mass concentration of chlorophyll a in sea water estimated from fluorescence ( mg m-3 )',
    21
  )
  const lines = wrapped.split('<br>')
  assert.equal(lines.length, 3)
  assert.ok(lines[1].endsWith('…'))
  assert.equal(lines[2], '( mg m-3 )')
})

test('a label with no unit still wraps, using every allowed line', () => {
  const lines = wrapLabel('some very long variable name with no unit', 14).split('<br>')
  assert.equal(lines.length, 3)
  assert.ok(lines.every((line) => !line.startsWith('(')))
})

test('an unknown width means do not wrap', () => {
  // buildFigure runs once before the plot area has been measured; wrapping
  // against a guessed width would be worse than not wrapping.
  assert.equal(maxCharsFor(0), 0)
  assert.equal(maxCharsFor(undefined), 0)
  assert.equal(wrapLabel('Practical Salinity ( PSU )', 0), 'Practical Salinity ( PSU )')
})

test('narrower panels allow fewer characters', () => {
  assert.ok(maxCharsFor(150) < maxCharsFor(170))
  assert.ok(maxCharsFor(170) < maxCharsFor(1140))
  assert.ok(maxCharsFor(10) >= 8) // a floor, so a label is never one char a line
})

test('panel titles wrap to their own panel once the width is known', () => {
  const wide = figure('TimeSeriesProfile', ALL_SIX, { size: { width: 1140, height: 620 } })
  const titles = ALL_SIX.map((_, index) =>
    wide.layout[index === 0 ? 'xaxis' : `xaxis${index + 1}`].title.text
  )
  // Six panels in 1140px is 150px each, and no line may be wider than that.
  const columns = marginFor(COLUMNS)
  const [start, end] = wide.layout.xaxis.domain
  const fits = maxCharsFor((1140 - columns.l - columns.r) * (end - start))
  titles.forEach((text) => {
    text.split('<br>').forEach((line) => {
      assert.ok(line.length <= fits, `"${line}" (${line.length} > ${fits})`)
    })
  })
  // And the labels that do not fit were the reason: they wrapped.
  assert.ok(titles.filter((text) => text.includes('<br>')).length >= 5, titles.join(' | '))
  // The same figure with no measured width leaves them on one line.
  const unsized = figure('TimeSeriesProfile', ALL_SIX)
  assert.ok(!unsized.layout.xaxis.title.text.includes('<br>'))
})

test('one panel is wide enough not to wrap', () => {
  const { layout } = figure('TimeSeriesProfile', ['TE90_01'],
    { size: { width: 1140, height: 620 } })
  assert.ok(!layout.xaxis.title.text.includes('<br>'))
})

test('hover text keeps the unwrapped label', () => {
  // A <br> in a hover box breaks the line where the panel needed it.
  const { data } = figure('TimeSeriesProfile', ALL_SIX,
    { size: { width: 1140, height: 620 } })
  assert.ok(data[0].layout === undefined)
  assert.ok(data[0].name.includes('Temperature (1990 scale)'))
  assert.ok(!data[0].name.includes('<br>'))
  assert.ok(data[0].hovertemplate.startsWith('Temperature (1990 scale) ( degree_C ):'))
  // The colour dimension used to add a third line here, off customdata.
  assert.ok(!data[0].hovertemplate.includes('customdata'))
})

// --- margins -----------------------------------------------------------------

test('each orientation reserves the edge its labels actually use', () => {
  // Without the title, which sits at the top of both.
  const columns = marginFor(COLUMNS, 0)
  const rows = marginFor(ROWS, 0)
  // A profile's panel titles are on top and nothing is drawn at its bottom; a
  // stack is the other way round.
  assert.ok(columns.t > columns.b)
  assert.ok(rows.b > rows.t)
  // Neither reserves width for a rotated title any more.
  assert.equal(columns.l, rows.l)
  // And the title is added to the top of each, never taken out of it.
  assert.equal(marginFor(COLUMNS, 2).t - columns.t, titleRoomFor(2))
  assert.equal(marginFor(ROWS, 2).t - rows.t, titleRoomFor(2))
})

test('the sizing floors pay for the gaps, so a panel really gets its minimum', () => {
  // The floors used to be n * MIN_PANEL_PX, which ignored the gaps between the
  // panels — so six panels were promised 150px each and drawn at 109px.
  for (const n of [2, 6, 14, 19]) {
    const width = plotWidthFor(COLUMNS, n, 100)
    const columns = marginFor(COLUMNS)
    const plotting = width - columns.l - columns.r
    const [start, end] = domainsFor(n, 0.22)[0]
    assert.ok(
      plotting * (end - start) >= MIN_PANEL_PX - 1,
      `n=${n}: ${(plotting * (end - start)).toFixed(0)}px panel`
    )

    const height = plotHeightFor(ROWS, n, 100)
    const rows = marginFor(ROWS)
    const stacked = height - rows.t - rows.b
    const [low, high] = domainsFor(n, 0.12)[0]
    assert.ok(
      stacked * (high - low) >= MIN_PANEL_PX - 1,
      `n=${n}: ${(stacked * (high - low)).toFixed(0)}px panel`
    )
  }
})

test('the gap is a share of a panel, not of the whole plot', () => {
  // At a fixed 5.5% of the plotting area, nineteen panels spent 99% of the
  // width on the eighteen gaps and each panel came out about a pixel wide.
  const domains = domainsFor(19, 0.22)
  const span = domains[0][1] - domains[0][0]
  assert.ok(span > 0.03, `${span} of the width per panel`)
  const gap = domains[1][0] - domains[0][1]
  assert.ok(Math.abs(gap / span - 0.22) < 0.01, `gap is ${(gap / span).toFixed(3)} of a panel`)
  assert.equal(panelPitch(19, 0.22), 19 + 18 * 0.22)
  assert.equal(panelPitch(1, 0.22), 1)
  assert.equal(panelPitch(0, 0.22), 0)
})

// --- one colour per variable -------------------------------------------------

test('a variable with no declared palette takes the next colour along', () => {
  const { data } = figure('TimeSeriesProfile', ALL_SIX)
  const colors = data.map((t) => t.marker.color)
  assert.equal(new Set(colors).size, 6)
  colors.forEach((color, index) => {
    assert.equal(color, defaultColorFor(undefined, index))
    // Markers and line agree: a mode of markers+lines must not draw two colours.
    assert.equal(data[index].line.color, color)
  })
})

test("a declared colorBarPalette decides the variable's colour", () => {
  // The publisher's own intent, harvested into table_variables: the plot opens
  // reading roughly the way an ERDDAP graph of the same dataset does.
  const { data } = figureFrom(VIKING_PALETTES, 'TimeSeriesProfile',
    ['TE90_01', 'PSAL_01', 'DOXY_01'])
  assert.equal(data[0].marker.color, paletteColorFor('KT_thermal'))
  assert.equal(data[1].marker.color, paletteColorFor('KT_haline'))
  // DOXY_01 declares nothing, so it keeps its place in the fallback list.
  assert.equal(data[2].marker.color, defaultColorFor(undefined, 2))
})

test("the user's colour beats both, on the line as well as the markers", () => {
  const { data } = figure('TimeSeriesProfile', ['TE90_01', 'PSAL_01'],
    { colors: { PSAL_01: '#123456' } })
  assert.equal(data[1].marker.color, '#123456')
  assert.equal(data[1].line.color, '#123456')
  // And only that one: an override is not a theme.
  assert.equal(data[0].marker.color, defaultColorFor(undefined, 0))
})

test('nothing draws a colourbar any anymore, and no width is kept for one', () => {
  const { data } = figure('TimeSeriesProfile', ALL_SIX)
  data.forEach((trace) => {
    assert.ok(!trace.marker.colorbar)
    assert.ok(!('showscale' in trace.marker))
    assert.ok(!trace.customdata)
  })
  assert.equal(plotWidthFor(COLUMNS, 8, 2000), 2000)
})

test('lines-only stays lines — nothing forces markers on any more', () => {
  // Markers used to be forced whenever colouring was on, because a per-point
  // colour has nothing to render on without one.
  const { data } = figure('TimeSeriesProfile', ['TE90_01'], { mode: 'lines' })
  assert.equal(data[0].mode, 'lines')
})

// --- the title names the record ----------------------------------------------

test('the title names every cf_role column, in ERDDAP order', () => {
  const variables = variablesFrom(VIKING, VIKING_DATASET)
  const plan = facetPlanFor(VIKING_DATASET, variables, DATA)
  assert.deepEqual(plan.titleColumns, ['station_id', 'profile'])
  assert.equal(
    recordTitleFor({ plan, variablesByName: byColumnName(variables), data: DATA }),
    TITLE
  )
})

test('a catalogue with no columnMeta still names the record', () => {
  // cf_role is only in columnMeta, which is absent entirely before a reharvest —
  // so the roles fall back to the dataset's own three *_id_variable fields, and
  // the labels fall back to the column names.
  const variables = variablesFrom(VIKING_NO_META, VIKING_DATASET)
  const plan = facetPlanFor(VIKING_DATASET, variables, DATA)
  assert.deepEqual(plan.titleColumns, ['station_id', 'profile'])
  assert.equal(
    recordTitleFor({ plan, variablesByName: byColumnName(variables), data: DATA }),
    'station_id: PMZA-RIKI — profile: PMZA-RIKI-25/09/16-17:35:26'
  )
})

test('a cf_role column with nothing in it is skipped, not printed empty', () => {
  const plan = { titleColumns: ['station_id', 'profile'] }
  const data = [{ station_id: 'PMZA-RIKI', profile: '   ' }]
  assert.equal(
    recordTitleFor({ plan, variablesByName: new Map(), data }),
    'station_id: PMZA-RIKI'
  )
  assert.equal(recordTitleFor({ plan, variablesByName: new Map(), data: [] }), '')
  assert.equal(recordTitleFor({ plan: null, variablesByName: new Map(), data }), '')
})

test('a window spanning several profiles names three and counts the rest', () => {
  const data = ['a', 'b', 'c', 'd', 'e'].map((profile) => ({ profile }))
  assert.equal(
    recordTitleFor({ plan: { titleColumns: ['profile'] }, variablesByName: new Map(), data }),
    'profile: a, b, c +2'
  )
})

test('the title is drawn where Plotly draws a title, and not by automargin', () => {
  const { layout } = figure('TimeSeriesProfile', ALL_SIX,
    { size: { width: 1140, height: 620 } })
  assert.equal(layout.title.text, TITLE)
  assert.equal(layout.title.font.size, TITLE_FONT_PX)
  assert.equal(layout.title.yref, 'container')
  assert.equal(layout.title.y, 1)
  assert.equal(layout.title.yanchor, 'top')
  assert.equal(layout.title.xanchor, 'center')
  // automargin would grow the top margin inside a height that is fixed here,
  // shrinking every panel below the minimum the floor promised.
  assert.ok(!('automargin' in layout.title))
})

test('the title costs the top margin only the lines it actually used', () => {
  assert.equal(titleLinesFor(TITLE, 1140), 1)
  assert.equal(titleLinesFor(TITLE, 340), 2)
  const wide = figure('TimeSeriesProfile', ['TE90_01'],
    { size: { width: 1140, height: 620 } })
  const narrow = figure('TimeSeriesProfile', ['TE90_01'],
    { size: { width: 340, height: 620 } })
  assert.equal(wide.layout.margin.t, marginFor(COLUMNS, 1).t)
  assert.equal(narrow.layout.margin.t, marginFor(COLUMNS, 2).t)
  assert.ok(narrow.layout.margin.t > wide.layout.margin.t)
  // And a stack sized for one line is shorter than one sized for the worst case.
  assert.ok(plotHeightFor(ROWS, 6, 100, 1) < plotHeightFor(ROWS, 6, 100, 2))
})

test('no title means no title and no room reserved for one', () => {
  const { layout } = figure('TimeSeriesProfile', ['TE90_01'], { title: '' })
  assert.ok(!layout.title)
  assert.equal(layout.margin.t, marginFor(COLUMNS, 0).t)
  assert.equal(titleRoomFor(0), 0)
  assert.equal(titleLinesFor('', 1140), 0)
})

test('the title wraps at the line cap rather than overflowing the figure', () => {
  const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')
  const lines = wrapTitleFor(long, 320).split('<br>')
  assert.equal(lines.length, MAX_TITLE_LINES)
  assert.ok(lines[lines.length - 1].endsWith('…'))
  // Wrapped at the FIGURE's width, not a panel's: it is centred on the figure.
  assert.ok(titleLinesFor(TITLE, 1140) < titleLinesFor(TITLE, 400))
})
