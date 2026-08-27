// The Plotly figure for a faceted record preview: one panel per selected
// variable, all sharing one axis.
//
// WHY EXPLICIT AXIS DOMAINS AND NOT layout.grid
// plotly.js-basic-dist-min 3.7.0 does bundle the grid component (pattern,
// roworder, xside, yside are all in the schema), but it resolves a grid into
// axis domains inside supplyLayoutDefaults — i.e. only against a real DOM. Doing
// the domain arithmetic here instead makes this function's return value the
// thing under test, so the whole layout is assertable under `node --test` in an
// environment with no browser. It is also the same shape the previous
// two-variable plot already used, just generalised from 2 axes to N.
//
// Axis wiring:
//   COLUMNS (profiles)  one shared `yaxis`, N x axes each with its own domain,
//                       all anchored to y. Traces: {xaxis:'x<i>', yaxis:'y'}.
//   ROWS (timeseries)   one shared `xaxis`, N y axes each with its own domain,
//                       all anchored to x. Traces: {xaxis:'x', yaxis:'y<i>'}.

import { COLUMNS } from './previewFacetPlan.js'
import { labelFor } from './previewVariables.js'
import { colorscaleFor } from './erddapPalettes.js'

// Room for the shared axis and its title, the panel titles, and the modebar.
const MARGIN = { l: 78, r: 26, t: 54, b: 62 }
// Gap between panels, as a fraction of the plotting area. Panel titles sit above
// each column, and a y axis label sits left of each row, so the two orientations
// need different gaps.
const COLUMN_GAP = 0.055
const ROW_GAP = 0.09
// Below this a panel is not worth drawing; the container scrolls instead.
export const MIN_PANEL_PX = 150
export const MIN_PLOT_PX = 320
// Extra width reserved for the colourbar and its title when colouring is on.
const COLORBAR_GUTTER = 108

// n evenly spaced [start, end] pairs over 0..1 with `gap` between them.
export function domainsFor (n, gap) {
  if (n <= 0) return []
  if (n === 1) return [[0, 1]]
  const span = (1 - gap * (n - 1)) / n
  return Array.from({ length: n }, (_, index) => {
    const start = index * (span + gap)
    // Round to kill float drift, which Plotly reports as an invalid domain when
    // the last end lands at 1.0000000000000002.
    return [Number(start.toFixed(6)), Number((start + span).toFixed(6))]
  })
}

// How tall the plot has to be. Constant in n for profiles, because the panels
// sit side by side and share one depth axis; growing for stacked panels, which
// is the case where "as many variables as the dataset has" and "no overflow"
// genuinely conflict.
export function plotHeightFor (orientation, panelCount, availableHeight) {
  const available = Math.max(availableHeight || 0, MIN_PLOT_PX)
  if (orientation === COLUMNS) return available
  const needed = panelCount * MIN_PANEL_PX + MARGIN.t + MARGIN.b
  return Math.max(available, needed)
}

// Profiles get narrow fast: six panels in a 1140 px modal is ~170 px each, which
// still reads, but the floor is what keeps a 14-column selection legible at the
// cost of a horizontal scroll.
export function plotWidthFor (orientation, panelCount, availableWidth, hasColorbar) {
  const gutter = hasColorbar ? COLORBAR_GUTTER : 0
  const available = Math.max(availableWidth || 0, 320)
  if (orientation !== COLUMNS) return available
  const needed = panelCount * MIN_PANEL_PX + MARGIN.l + MARGIN.r + gutter
  return Math.max(available, needed)
}

const axisKey = (letter, index) =>
  index === 0 ? `${letter}axis` : `${letter}axis${index + 1}`
const axisRef = (letter, index) => (index === 0 ? letter : `${letter}${index + 1}`)

const finiteValues = (data, columnName) => {
  const values = []
  ;(data || []).forEach((row) => {
    const value = Number(row[columnName])
    if (Number.isFinite(value)) values.push(value)
  })
  return values
}

// Panel trace colours. The image draws each variable in its own solid colour;
// these are that palette, extended so a 14-column selection stays distinguishable.
const PANEL_COLORS = [
  '#2ca02c', '#1f77b4', '#d62728', '#ff7f0e', '#9467bd', '#8c564b',
  '#17becf', '#e377c2', '#bcbd22', '#7f7f7f', '#393b79', '#637939'
]

export function panelColorFor (index) {
  return PANEL_COLORS[index % PANEL_COLORS.length]
}

/**
 * @param plan          from facetPlanFor()
 * @param variablesByName Map columnName -> variable (previewVariables)
 * @param panels        resolved column names, one panel each
 * @param sharedAxis    column name shared by every panel
 * @param data          array of row objects
 * @param colorBy       column name or null
 * @param colorscale    named Plotly colorscale for the colour dimension
 * @param labels        { [columnName]: customLabel }
 * @param mode          'markers' | 'lines' | 'markers+lines'
 * @param size          { width, height }
 * @param uirevision    changes whenever the axis set changes
 */
export function buildFigure ({
  plan,
  variablesByName,
  panels,
  sharedAxis,
  data,
  colorBy,
  colorscale,
  labels = {},
  mode = 'markers',
  size = {},
  uirevision
}) {
  const titleFor = (columnName) => {
    const custom = labels[columnName] && labels[columnName].trim()
    const variable = variablesByName.get(columnName)
    if (!custom) return labelFor(variable)
    return variable && variable.unit ? `${custom} ( ${variable.unit} )` : custom
  }

  const isColumns = plan.orientation === COLUMNS
  const gap = isColumns ? COLUMN_GAP : ROW_GAP
  const domains = domainsFor(panels.length, gap)

  // The colour dimension spans every panel, so one colourbar and one shared
  // range. colorBarMinimum/Maximum from the harvest beat the data range; never
  // actual_range, which carries fill sentinels (TE90_01 declares a max of
  // 191277.0 degrees C on mpoPmzaVikingCtdInsitu).
  const colorVariable = colorBy ? variablesByName.get(colorBy) : null
  let colorValues
  let cmin
  let cmax
  if (colorVariable && data) {
    colorValues = data.map((row) => Number(row[colorVariable.columnName]))
    const finite = finiteValues(data, colorVariable.columnName)
    cmin = Number.isFinite(colorVariable.cmin)
      ? colorVariable.cmin
      : (finite.length ? Math.min(...finite) : undefined)
    cmax = Number.isFinite(colorVariable.cmax)
      ? colorVariable.cmax
      : (finite.length ? Math.max(...finite) : undefined)
  }
  const colorActive = Boolean(colorVariable && data)
  // A colour value only shows on markers, so force them on.
  const effectiveMode =
    colorActive && !mode.includes('markers') ? 'markers+lines' : mode

  const layout = {
    uirevision,
    margin: { ...MARGIN, r: MARGIN.r + (colorActive ? COLORBAR_GUTTER : 0) },
    showlegend: false, // each panel is titled; a legend would repeat it
    hovermode: 'closest',
    dragmode: 'zoom',
    modebar: { orientation: 'v' },
    ...(size.width ? { width: size.width } : {}),
    ...(size.height ? { height: size.height } : {})
  }

  const sharedTitle = titleFor(sharedAxis)
  const sharedAxisSettings = {
    automargin: true,
    title: { text: sharedTitle },
    ...(plan.sharedReversed ? { autorange: 'reversed' } : {})
  }

  if (isColumns) {
    // One depth axis on the left, spanning the full height.
    layout.yaxis = { ...sharedAxisSettings, domain: [0, 1], anchor: 'x' }
  } else {
    layout.xaxis = { ...sharedAxisSettings, domain: [0, 1], anchor: 'y' }
  }

  const traces = panels.map((columnName, index) => {
    const domain = domains[index]
    const panelTitle = titleFor(columnName)

    if (isColumns) {
      layout[axisKey('x', index)] = {
        domain,
        anchor: 'y',
        automargin: true,
        side: 'top', // the image titles each profile panel above it
        title: { text: panelTitle },
        zeroline: false
      }
    } else {
      // domainsFor counts up from 0, and 0 is the BOTTOM of a Plotly y axis, so
      // panel order already puts the first selected variable lowest — which is
      // how the image stacks them.
      layout[axisKey('y', index)] = {
        domain: domains[index],
        anchor: 'x',
        automargin: true,
        title: { text: panelTitle },
        zeroline: false
      }
    }

    const sharedValues = (data || []).map((row) => row[sharedAxis])
    const panelValues = (data || []).map((row) => row[columnName])

    return {
      type: 'scatter',
      mode: effectiveMode,
      name: panelTitle,
      x: isColumns ? panelValues : sharedValues,
      y: isColumns ? sharedValues : panelValues,
      xaxis: isColumns ? axisRef('x', index) : 'x',
      yaxis: isColumns ? 'y' : axisRef('y', index),
      hovertemplate:
        (isColumns
          ? `${panelTitle}: %{x}<br>${sharedTitle}: %{y}`
          : `${sharedTitle}: %{x}<br>${panelTitle}: %{y}`) +
        (colorActive ? `<br>${titleFor(colorBy)}: %{customdata}` : '') +
        '<extra></extra>',
      ...(colorActive
        ? {
          marker: {
            color: colorValues,
            colorscale: colorscaleFor(colorVariable, colorscale),
            cmin,
            cmax,
            // One bar for the whole figure: the range is shared, so N bars
            // would be N copies of the same scale.
            showscale: index === 0,
            ...(index === 0
              ? {
                colorbar: {
                  title: { text: titleFor(colorBy), side: 'right' },
                  thickness: 14,
                  len: 0.9,
                  x: 1.02,
                  xanchor: 'left',
                  y: 0.5,
                  yanchor: 'middle'
                }
              }
              : {})
          },
          customdata: colorValues
        }
        : { marker: { color: panelColorFor(index) }, line: { color: panelColorFor(index) } })
    }
  })

  return { data: traces, layout }
}
