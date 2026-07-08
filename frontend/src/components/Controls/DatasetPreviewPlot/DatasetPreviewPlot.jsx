import React, { useEffect, useState } from 'react'
import { Dropdown, DropdownButton, OverlayTrigger, Tooltip } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'
import './styles.css'

import Plotly from 'Plotly'
import createPlotlyComponent from 'createPlotlyComponent'
const Plot = createPlotlyComponent(Plotly)

export default function DatasetPreviewPlot({
  inspectDataset,
  plotAxes,
  datasetPreview,
  setPlotAxes,
  inspectRecordID,
  data
}) {
  const { t, i18n } = useTranslation()
  const [plotType, setPlotType] = useState('markers')
  // User-provided display names per role (blank = use the raw column name).
  const [customLabels, setCustomLabels] = useState({ x: '', y: '', secondary: '', color: '' })
  const [showLabels, setShowLabels] = useState(false)
  // Colorscale display prefs (not reset on record switch, like plotType). When a
  // second variable is present the user can opt into a different scale per trace.
  const [dualColorscale, setDualColorscale] = useState(false)
  const [colorscales, setColorscales] = useState({ primary: 'Viridis', secondary: 'Reds' })

  const isProfile = inspectDataset.cdm_data_type
    .toLowerCase()
    .includes('profile')

  useEffect(() => {
    // Reset any custom names when switching to a different record.
    setCustomLabels({ x: '', y: '', secondary: '', color: '' })
    switch (inspectDataset.cdm_data_type) {
    case 'Profile':
    case 'TimeSeriesProfile':
      setPlotAxes({
        x: {
          columnName: inspectDataset.first_eov_column,
          unit: datasetPreview?.table?.columnUnits[datasetPreview?.table?.columnNames.indexOf(inspectDataset.first_eov_column)]
        },
        y: {
          columnName: 'depth',
          unit: 'm'
        },
        secondary: null,
        color: null
      })
      break
    case 'TimeSeries':
      setPlotAxes({
        x: {
          columnName: 'time',
          unit: 'UTC'
        },
        y: {
          columnName: inspectDataset.first_eov_column,
          unit: datasetPreview?.table?.columnUnits[datasetPreview?.table?.columnNames.indexOf(inspectDataset.first_eov_column)]
        },
        secondary: null,
        color: null
      })
      break

    default:
      break
    }
  }, [inspectRecordID])

  const columnNames = datasetPreview?.table?.columnNames || []
  const columnUnits = datasetPreview?.table?.columnUnits || []

  // Resolve the display name for a role: custom name if set, else column name.
  const resolveName = (role, axis) =>
    (customLabels[role] && customLabels[role].trim()) || axis?.columnName || ''

  // "name ( unit )" title for an axis / colorbar (used when not renamed).
  const axisTitle = (axis) =>
    axis?.columnName
      ? `${axis.columnName}${axis.unit ? ` ( ${axis.unit} )` : ''}`
      : ''

  // Axis / colorbar title: use the custom name when set, otherwise the column
  // name — and in both cases keep the "( unit )" suffix so the unit never drops.
  const axisTitleFor = (role, axis) => {
    const custom = customLabels[role] && customLabels[role].trim()
    if (!custom) return axisTitle(axis)
    return `${custom}${axis?.unit ? ` ( ${axis.unit} )` : ''}`
  }

  // Color dimension: precompute the color values and a shared min/max so both
  // traces span the same numeric range.
  let colorValues
  let cmin
  let cmax
  if (plotAxes.color && data) {
    colorValues = data.map((row) => Number(row[plotAxes.color.columnName]))
    const finite = colorValues.filter((value) => Number.isFinite(value))
    cmin = finite.length ? Math.min(...finite) : undefined
    cmax = finite.length ? Math.max(...finite) : undefined
  }

  // A color variable only shows on markers, so force markers on when it is set.
  const effectiveMode = plotAxes.color
    ? (plotType.includes('markers') ? plotType : 'markers+lines')
    : plotType

  // Both traces are colored by the color value; marker SHAPE (circle vs diamond)
  // always tells the two variables apart, so they stay distinct even when they
  // share a colorscale. The user picks the scale, and may opt into a different
  // scale per trace (then each trace gets its own colorbar, stacked in the gutter
  // so a long title can't overlap the neighbour).
  const colorActive = !!(plotAxes.color && data)
  const hasSecondary = !!plotAxes.secondary?.columnName
  // A timeseries second variable puts an axis on the RIGHT side of the plot, so
  // the gutter (legend + colorbar) has to start further right to clear it. A
  // profile's second variable goes on the top axis, so no extra gap is needed.
  const rightAxisPresent = hasSecondary && !isProfile
  const gutterX = rightAxisPresent ? 1.16 : 1.06
  // Named scales available in the plotly-basic 1.58.5 bundle we ship.
  const COLORSCALE_OPTIONS = [
    'Viridis', 'Cividis', 'Blues', 'Greens', 'Reds',
    'YlGnBu', 'YlOrRd', 'Hot', 'Bluered', 'RdBu',
    'Portland', 'Jet', 'Electric', 'Earth', 'Greys'
  ]
  const MARKER_SYMBOLS = ['circle', 'diamond']
  // Different-scale-per-trace only means anything with a second colored trace.
  const dualScale = dualColorscale && hasSecondary
  const scaleFor = (index) =>
    index === 1 && dualScale ? colorscales.secondary : colorscales.primary

  // One centered colorbar normally; two stacked bars when each trace has its
  // own scale (same x, so a long title never overlaps the neighbour).
  const colorbarFor = (index) => {
    const base = {
      title: axisTitleFor('color', plotAxes.color),
      titleside: 'top',
      thickness: 14,
      x: gutterX,
      xanchor: 'left'
    }
    if (dualScale) {
      return { ...base, len: 0.3, y: index === 0 ? 0.82 : 0.42, yanchor: 'top' }
    }
    return { ...base, len: 0.7, y: 0.5, yanchor: 'middle' }
  }

  // Marker props for a trace; `index` selects its scale + shape. With a shared
  // scale only the first trace draws the colorbar; with different scales each
  // trace shows its own. The color value rides along as `customdata` for hover.
  const colorPropsFor = (index) =>
    colorActive
      ? {
        marker: {
          color: colorValues,
          colorscale: scaleFor(index),
          cmin,
          cmax,
          symbol: MARKER_SYMBOLS[index] || MARKER_SYMBOLS[0],
          showscale: dualScale ? true : index === 0,
          ...((dualScale || index === 0) ? { colorbar: colorbarFor(index) } : {})
        },
        customdata: colorValues
      }
      : {}

  // Hover tooltip: the two axis names for the trace, plus the color value when
  // the color dimension is active (`hovertemplate` is available in this Plotly).
  const colorName = resolveName('color', plotAxes.color)
  const hoverTemplateFor = (xName, yName) =>
    `${xName}: %{x}<br>${yName}: %{y}` +
    (colorActive ? `<br>${colorName}: %{customdata}` : '') +
    '<extra></extra>'

  // Build the traces: always the primary trace, plus a secondary-axis trace when
  // a second variable is selected (max 2 variables).
  const traces = []
  if (plotAxes.x && plotAxes.y && data) {
    traces.push({
      x: data.map((row) => row[plotAxes.x.columnName]),
      y: data.map((row) => row[plotAxes.y.columnName]),
      type: 'scatter',
      mode: effectiveMode,
      name: isProfile ? resolveName('x', plotAxes.x) : resolveName('y', plotAxes.y),
      hovertemplate: hoverTemplateFor(resolveName('x', plotAxes.x), resolveName('y', plotAxes.y)),
      ...colorPropsFor(0)
    })

    if (plotAxes.secondary?.columnName) {
      const secondaryTrace = {
        type: 'scatter',
        mode: effectiveMode,
        name: resolveName('secondary', plotAxes.secondary),
        ...colorPropsFor(1)
      }
      if (isProfile) {
        // Second variable on a second X axis, sharing depth (y)
        secondaryTrace.x = data.map((row) => row[plotAxes.secondary.columnName])
        secondaryTrace.y = data.map((row) => row[plotAxes.y.columnName])
        secondaryTrace.xaxis = 'x2'
        secondaryTrace.hovertemplate = hoverTemplateFor(resolveName('secondary', plotAxes.secondary), resolveName('y', plotAxes.y))
      } else {
        // Second variable on a second Y axis, sharing the x variable (e.g. time)
        secondaryTrace.x = data.map((row) => row[plotAxes.x.columnName])
        secondaryTrace.y = data.map((row) => row[plotAxes.secondary.columnName])
        secondaryTrace.yaxis = 'y2'
        secondaryTrace.hovertemplate = hoverTemplateFor(resolveName('x', plotAxes.x), resolveName('secondary', plotAxes.secondary))
      }
      traces.push(secondaryTrace)
    }
  }

  // Dynamic title built from the current selection: the "variable" axis is X for
  // profiles and Y for timeseries; the other axis is the shared depth/time index.
  const variableName = isProfile ? resolveName('x', plotAxes.x) : resolveName('y', plotAxes.y)
  const indexName = isProfile ? resolveName('y', plotAxes.y) : resolveName('x', plotAxes.x)
  const secondName = plotAxes.secondary?.columnName ? resolveName('secondary', plotAxes.secondary) : ''
  let plotTitle
  if (variableName && indexName) {
    plotTitle = `${variableName}${secondName ? ` & ${secondName}` : ''} ${t('datasetPreviewPlotTitleVs')} ${indexName}`
    if (plotAxes.color) {
      plotTitle += ` (${t('datasetPreviewPlotTitleColoredBy')} ${colorName})`
    }
  } else {
    plotTitle = inspectDataset.title
      ? `${inspectDataset.title}: ${inspectRecordID}`
      : `${inspectRecordID}`
  }

  // Plotly titles don't auto-wrap: break a long one onto as many lines as it
  // needs at word boundaries (inserting <br>) so it stays inside the plot width
  // instead of being clipped or colliding with the toolbar.
  const wrapTitle = (text, maxChars = 60) => {
    const words = String(text).split(' ')
    const lines = []
    let line = ''
    words.forEach((word) => {
      if (line && line.length + 1 + word.length > maxChars) {
        lines.push(line)
        line = word
      } else {
        line = line ? `${line} ${word}` : word
      }
    })
    if (line) lines.push(line)
    return lines.join('<br>')
  }
  const wrappedTitle = wrapTitle(plotTitle)
  const titleLineCount = wrappedTitle.split('<br>').length

  const layout = {
    uirevision: true,
    autosize: true,
    // Title lives in the layout (so it is part of the saved image). Colorbar(s)
    // and legend live in the right gutter, so widen the right margin to leave a
    // clear gap between them and the plot (wider still when a right-side axis
    // pushes the gutter out).
    title: wrappedTitle,
    margin: {
      // Extra top room per wrapped title line so multi-line titles never overlap the plot.
      t: 60 + (titleLineCount - 1) * 24,
      r: (colorActive || hasSecondary) ? (rightAxisPresent ? 220 : 170) : 80
    },
    showlegend: traces.length > 1,
    yaxis: {
      automargin: true,
      side: isProfile ? 'top' : undefined,
      autorange: isProfile ? 'reversed' : undefined,
      title: axisTitleFor('y', plotAxes.y),
      uirevision: true
    },
    xaxis: {
      automargin: true,
      title: axisTitleFor('x', plotAxes.x),
      uirevision: true
    },
    dragmode: 'zoom',
    // Stack the toolbar vertically in the top-right corner so its icons no longer
    // sit in the title's horizontal band (the long two-variable title used to
    // collide with the horizontal toolbar).
    modebar: {
      orientation: 'v',
      uirevision: true
    }
  }

  if (plotAxes.secondary?.columnName) {
    // Push the trace legend into the right gutter, above the colorbar(s).
    layout.legend = { x: gutterX, xanchor: 'left', y: 1, yanchor: 'top' }
    if (isProfile) {
      layout.xaxis2 = {
        overlaying: 'x',
        side: 'top',
        automargin: true,
        title: axisTitleFor('secondary', plotAxes.secondary),
        uirevision: true
      }
    } else {
      layout.yaxis2 = {
        overlaying: 'y',
        side: 'right',
        automargin: true,
        title: axisTitleFor('secondary', plotAxes.secondary),
        uirevision: true
      }
    }
  }

  // A caption + fixed-width dropdown button for choosing the column of a role.
  // The button truncates; hovering it shows the full value in a tooltip.
  const variableRow = (role, captionKey, axis, includeNone) => {
    const value = axis?.columnName || (includeNone ? t('datasetPreviewPlotNone') : '')
    return (
      <div className="controlRow" key={role}>
        <span className="controlCaption">{t(captionKey)}</span>
        <OverlayTrigger
          placement="right"
          trigger={['hover', 'focus']}
          overlay={<Tooltip id={`tooltip-${role}`}>{value}</Tooltip>}
        >
          <span className="controlButtonWrap">
            <DropdownButton className="dropdownButtonLeft" title={value}>
              {includeNone && (
                <Dropdown.Item
                  key={`__none_${role}`}
                  onClick={() => setPlotAxes({ ...plotAxes, [role]: null })}
                >
                  {t('datasetPreviewPlotNone')}
                </Dropdown.Item>
              )}
              {datasetPreview &&
                columnNames.map((columnName, index) => (
                  <Dropdown.Item
                    key={columnName}
                    onClick={() => {
                      setPlotAxes({ ...plotAxes, [role]: { columnName, unit: columnUnits[index] } })
                      setCustomLabels((prev) => ({ ...prev, [role]: '' }))
                    }}
                  >
                    {columnName}
                  </Dropdown.Item>
                ))}
            </DropdownButton>
          </span>
        </OverlayTrigger>
      </div>
    )
  }

  // A caption + fixed-width dropdown for picking a colorscale. Same layout as
  // variableRow; the button shows the current scale and hovering reveals it.
  const colorscaleRow = (role, captionKey, value, onSelect) => (
    <div className="controlRow" key={role}>
      <span className="controlCaption">{t(captionKey)}</span>
      <OverlayTrigger
        placement="right"
        trigger={['hover', 'focus']}
        overlay={<Tooltip id={`tooltip-${role}`}>{value}</Tooltip>}
      >
        <span className="controlButtonWrap">
          <DropdownButton className="dropdownButtonLeft" title={value}>
            {COLORSCALE_OPTIONS.map((scale) => (
              <Dropdown.Item key={scale} onClick={() => onSelect(scale)}>
                {scale}
              </Dropdown.Item>
            ))}
          </DropdownButton>
        </span>
      </OverlayTrigger>
    </div>
  )

  // A rename field for a role, shown in the collapsible "Customize plot" panel.
  const renameField = (role, axis, caption) => (
    <div className="labelEditorRow" key={role}>
      <label htmlFor={`rename-${role}`}>{caption}</label>
      <input
        id={`rename-${role}`}
        type="text"
        value={customLabels[role]}
        placeholder={axis?.columnName || ''}
        onChange={(e) => setCustomLabels((prev) => ({ ...prev, [role]: e.target.value }))}
      />
    </div>
  )

  return (
    <div className="datasetPreviewControls">
      <div className="datasetPreviewControlsColumn">
        {variableRow('x', 'datasetPreviewPlotXAxisSelect', plotAxes.x, false)}
        {variableRow('y', 'datasetPreviewPlotYAxisSelect', plotAxes.y, false)}
        {variableRow('secondary', 'datasetPreviewPlotSecondVariableSelect', plotAxes.secondary, true)}
        {variableRow('color', 'datasetPreviewPlotColorSelect', plotAxes.color, true)}

        <button
          type="button"
          className="labelEditorToggle"
          onClick={() => setShowLabels((show) => !show)}
        >
          {(showLabels ? '▾ ' : '▸ ') + t('datasetPreviewPlotCustomizePlot')}
        </button>
        {showLabels && (
          <div className="labelEditor">
            {colorActive && colorscaleRow(
              'colorscale', 'datasetPreviewPlotColorScale', colorscales.primary,
              (scale) => setColorscales((prev) => ({ ...prev, primary: scale })))}

            {colorActive && hasSecondary && (
              <label className="controlRow controlCheckboxRow" htmlFor="dualColorscale">
                <input
                  id="dualColorscale"
                  type="checkbox"
                  checked={dualColorscale}
                  onChange={(e) => setDualColorscale(e.target.checked)}
                />
                <span>{t('datasetPreviewPlotDifferentColorScale')}</span>
              </label>
            )}

            {colorActive && dualColorscale && hasSecondary && colorscaleRow(
              'colorscaleSecondary', 'datasetPreviewPlotSecondColorScale', colorscales.secondary,
              (scale) => setColorscales((prev) => ({ ...prev, secondary: scale })))}

            {renameField('x', plotAxes.x, t('datasetPreviewPlotXAxisSelect'))}
            {renameField('y', plotAxes.y, t('datasetPreviewPlotYAxisSelect'))}
            {plotAxes.secondary?.columnName &&
              renameField('secondary', plotAxes.secondary, t('datasetPreviewPlotSecondVariableSelect'))}
            {plotAxes.color?.columnName &&
              renameField('color', plotAxes.color, t('datasetPreviewPlotColorSelect'))}
          </div>
        )}
      </div>

      <div className="datasetPreviewPlotArea">
        <div className="datasetPreviewPlotHeader">
          <DropdownButton
            className="dropdownButtonRight dropdownButton"
            title={t('plotType') + ': ' + t(plotType)}
          >
            <Dropdown.Item onClick={() => setPlotType('markers')}>
              {t('markers')}
            </Dropdown.Item>
            <Dropdown.Item onClick={() => setPlotType('lines')}>
              {t('line')}
            </Dropdown.Item>
            <Dropdown.Item onClick={() => setPlotType('markers+lines')}>
              {t('markersAndLine')}
            </Dropdown.Item>
          </DropdownButton>
        </div>
        <div className="datasetPreviewPlot">
          {traces.length > 0 && (
            <Plot
              data={traces}
              layout={layout}
              config={{
                displaylogo: false,
                modeBarButtonsToRemove: ['select2d', 'lasso2d', 'resetScale', 'pan2d'],
                responsive: true,
                scrollZoom: true,
                locale: i18n.language === 'fr' ? 'fr' : 'en',
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
