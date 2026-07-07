import React, { useEffect, useState } from 'react'
import { Dropdown, DropdownButton } from 'react-bootstrap'
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

  const isProfile = inspectDataset.cdm_data_type
    .toLowerCase()
    .includes('profile')

  useEffect(() => {
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

  // Build a "name ( unit )" title for an axis / colorbar
  const axisTitle = (axis) =>
    axis?.columnName
      ? `${axis.columnName}${axis.unit ? ` ( ${axis.unit} )` : ''}`
      : ''

  // Color dimension: precompute the color values and a shared min/max so both
  // traces span the same numeric range (this Plotly build predates `coloraxis`).
  let colorValues
  let cmin
  let cmax
  if (plotAxes.color && data) {
    colorValues = data.map((row) => Number(row[plotAxes.color.columnName]))
    const finite = colorValues.filter((value) => Number.isFinite(value))
    cmin = finite.length ? Math.min(...finite) : undefined
    cmax = finite.length ? Math.max(...finite) : undefined
  }

  // A color variable only shows on markers, so force markers on when it is set
  const effectiveMode = plotAxes.color
    ? (plotType.includes('markers') ? plotType : 'markers+lines')
    : plotType

  // Each trace gets its own colorscale + colorbar so the two variables are
  // distinguishable. Colorbars are vertical (Plotly 1.33.1 has no horizontal
  // orientation) and placed at the top-right, side by side when there are two.
  const colorActive = !!(plotAxes.color && data)
  const hasSecondary = !!plotAxes.secondary?.columnName
  const COLORSCALES = ['Viridis', 'YlOrRd']

  const colorbarFor = (index) => ({
    title: axisTitle(plotAxes.color),
    titleside: 'top',
    thickness: 12,
    len: hasSecondary ? 0.45 : 0.6,
    x: 1.02 + index * 0.16,
    xanchor: 'left',
    y: 1,
    yanchor: 'top'
  })

  // Marker + hover props for a trace; `index` selects its colorscale/colorbar.
  // Also surfaces the color-by value in the hover tooltip (via text + hoverinfo,
  // since `hovertemplate` does not exist in Plotly 1.33.1).
  const colorPropsFor = (index) =>
    colorActive
      ? {
        marker: {
          color: colorValues,
          colorscale: COLORSCALES[index] || COLORSCALES[0],
          cmin,
          cmax,
          showscale: true,
          colorbar: colorbarFor(index)
        },
        text: colorValues.map((value) => `${plotAxes.color.columnName}: ${value}`),
        hoverinfo: 'x+y+text'
      }
      : {}

  // Build the traces: always the primary trace, plus a secondary-axis trace
  // when a second variable is selected (max 2 variables). When no color
  // variable is set, the trace is identical to the original single-variable plot.
  const traces = []
  if (plotAxes.x && plotAxes.y && data) {
    traces.push({
      x: data.map((row) => row[plotAxes.x.columnName]),
      y: data.map((row) => row[plotAxes.y.columnName]),
      type: 'scatter',
      mode: effectiveMode,
      name: isProfile ? plotAxes.x.columnName : plotAxes.y.columnName,
      ...colorPropsFor(0)
    })

    if (plotAxes.secondary?.columnName) {
      const secondaryTrace = {
        type: 'scatter',
        mode: effectiveMode,
        name: plotAxes.secondary.columnName,
        ...colorPropsFor(1)
      }
      if (isProfile) {
        // Second variable on a second X axis, sharing depth (y)
        secondaryTrace.x = data.map((row) => row[plotAxes.secondary.columnName])
        secondaryTrace.y = data.map((row) => row[plotAxes.y.columnName])
        secondaryTrace.xaxis = 'x2'
      } else {
        // Second variable on a second Y axis, sharing the x variable (e.g. time)
        secondaryTrace.x = data.map((row) => row[plotAxes.x.columnName])
        secondaryTrace.y = data.map((row) => row[plotAxes.secondary.columnName])
        secondaryTrace.yaxis = 'y2'
      }
      traces.push(secondaryTrace)
    }
  }

  // Dynamic title built from the current selection: the "variable" axis is X for
  // profiles and Y for timeseries; the other axis is the shared depth/time index.
  const variableName = isProfile ? plotAxes.x?.columnName : plotAxes.y?.columnName
  const indexName = isProfile ? plotAxes.y?.columnName : plotAxes.x?.columnName
  const secondName = plotAxes.secondary?.columnName
  let plotTitle
  if (variableName && indexName) {
    plotTitle = `${variableName}${secondName ? ` & ${secondName}` : ''} ${t('datasetPreviewPlotTitleVs')} ${indexName}`
    if (plotAxes.color) {
      plotTitle += ` (${t('datasetPreviewPlotTitleColoredBy')} ${plotAxes.color.columnName})`
    }
  } else {
    plotTitle = inspectDataset.title
      ? `${inspectDataset.title}: ${inspectRecordID}`
      : `${inspectRecordID}`
  }

  const layout = {
    uirevision: true,
    autosize: true,
    title: plotTitle,
    showlegend: traces.length > 1,
    yaxis: {
      automargin: true,
      side: isProfile ? 'top' : undefined,
      autorange: isProfile ? 'reversed' : undefined,
      title: axisTitle(plotAxes.y),
      uirevision: true
    },
    xaxis: {
      automargin: true,
      title: axisTitle(plotAxes.x),
      uirevision: true
    },
    dragmode: 'zoom',
    modebar: {
      uirevision: true
    }
  }

  if (plotAxes.secondary?.columnName) {
    if (isProfile) {
      layout.xaxis2 = {
        overlaying: 'x',
        side: 'top',
        automargin: true,
        title: axisTitle(plotAxes.secondary),
        uirevision: true
      }
    } else {
      layout.yaxis2 = {
        overlaying: 'y',
        side: 'right',
        automargin: true,
        title: axisTitle(plotAxes.secondary),
        uirevision: true
      }
    }
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <DropdownButton
            className="dropdownButtonLeft"
            title={t('datasetPreviewPlotXAxisSelect') + ': ' + plotAxes.x.columnName}
          >
            {datasetPreview &&
              columnNames.map((columnName, index) => {
                return (
                  <Dropdown.Item
                    key={columnName}
                    onClick={() => setPlotAxes({ ...plotAxes, x: { columnName, unit: columnUnits[index] } })}
                  >
                    {columnName}
                  </Dropdown.Item>
                )
              })}
          </DropdownButton>
          <DropdownButton
            className="dropdownButtonLeft"
            title={t('datasetPreviewPlotYAxisSelect') + ': ' + plotAxes.y.columnName}
          >
            {datasetPreview &&
              columnNames.map((columnName, index) => {
                return (
                  <Dropdown.Item
                    key={columnName}
                    onClick={() => setPlotAxes({ ...plotAxes, y: { columnName, unit: columnUnits[index] } })}
                  >
                    {columnName}
                  </Dropdown.Item>
                )
              })}
          </DropdownButton>
          <DropdownButton
            className="dropdownButtonLeft"
            title={t('datasetPreviewPlotSecondVariableSelect') + ': ' + (plotAxes.secondary?.columnName || t('datasetPreviewPlotNone'))}
          >
            <Dropdown.Item
              key="__none_secondary"
              onClick={() => setPlotAxes({ ...plotAxes, secondary: null })}
            >
              {t('datasetPreviewPlotNone')}
            </Dropdown.Item>
            {datasetPreview &&
              columnNames.map((columnName, index) => {
                return (
                  <Dropdown.Item
                    key={columnName}
                    onClick={() => setPlotAxes({ ...plotAxes, secondary: { columnName, unit: columnUnits[index] } })}
                  >
                    {columnName}
                  </Dropdown.Item>
                )
              })}
          </DropdownButton>
          <DropdownButton
            className="dropdownButtonLeft"
            title={t('datasetPreviewPlotColorSelect') + ': ' + (plotAxes.color?.columnName || t('datasetPreviewPlotNone'))}
          >
            <Dropdown.Item
              key="__none_color"
              onClick={() => setPlotAxes({ ...plotAxes, color: null })}
            >
              {t('datasetPreviewPlotNone')}
            </Dropdown.Item>
            {datasetPreview &&
              columnNames.map((columnName, index) => {
                return (
                  <Dropdown.Item
                    key={columnName}
                    onClick={() => setPlotAxes({ ...plotAxes, color: { columnName, unit: columnUnits[index] } })}
                  >
                    {columnName}
                  </Dropdown.Item>
                )
              })}
          </DropdownButton>
        </div>
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
      <div className='datasetPreviewPlot'>
        <>
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
        </>
      </div>
    </>
  )
}
