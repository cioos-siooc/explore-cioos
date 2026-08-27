import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dropdown, DropdownButton } from '../../ui/Dropdown.jsx'
import Tooltip from '../../ui/Tooltip.jsx'
import useElementSize from '../../ui/useElementSize.js'
import './styles.css'

import Plotly from 'plotly.js-basic-dist-min'
import createPlotlyComponent from 'react-plotly.js/factory'
import frLocale from 'plotly.js-locales/fr'

import {
  labelFor,
  shortLabelFor,
  measurementsOf
} from '../DatasetPreview/previewVariables.js'
import { sharedCandidatesFor } from '../DatasetPreview/previewFacetPlan.js'
import {
  buildFigure,
  plotHeightFor,
  plotWidthFor
} from '../DatasetPreview/previewFacetFigure.js'
import { COLORSCALE_OPTIONS } from '../DatasetPreview/erddapPalettes.js'

Plotly.register(frLocale)
const Plot = createPlotlyComponent(Plotly)

// One panel per variable, all sharing one axis. The arrangement per
// cdm_data_type lives in previewFacetPlan.js and the figure itself in
// previewFacetFigure.js — both pure, so the layout is testable without a
// browser. This file is the controls and the sizing.
//
// Everything describing the plot is owned by DatasetPreview: the panels, the
// shared axis and the display prefs live in the query string
// (usePreviewPlotParams) so a link reproduces them, and the per-column renames
// are plain state up there. None of it can live here, because this component is
// unmounted every time the user flips to the Table and back — which is how the
// axes, the plot type and the colorscales all used to get silently discarded.
export default function DatasetPreviewPlot ({
  inspectRecordID,
  data,
  variables,
  variablesByName,
  plan,
  sharedAxis,
  setSharedAxis,
  panels,
  togglePanel,
  setPanels,
  colorBy,
  setColorBy,
  plotType,
  setPlotType,
  colorscale,
  setColorscale,
  customLabels,
  setCustomLabels,
  uirevision,
  // clientHeight of the modal's one scroll container. An INPUT to the plot's
  // height — never the plot's own box, which would be a feedback loop.
  availableHeight
}) {
  const { t, i18n } = useTranslation()
  // Purely local: a disclosure triangle is not worth a param, and nobody wants
  // to share which panel they had folded open.
  const [showLabels, setShowLabels] = useState(false)

  // Width comes from the element that owns it: the plot area is flex-sized by
  // the row, independent of how tall the figure ends up.
  const [plotAreaRef, plotAreaSize] = useElementSize()
  // The plot-type row above the figure. Measured rather than assumed because its
  // height has to come OFF the budget — a figure as tall as the whole scroller
  // plus this row is taller than the scroller, which would put a scrollbar back
  // even on a single panel. Its own height is content-driven and so independent
  // of the figure: no feedback loop.
  const [headerRef, headerSize] = useElementSize()

  const measurements = measurementsOf(variables)
  const sharedCandidates = sharedCandidatesFor(variables)
  const colorActive = Boolean(colorBy)

  const height = plotHeightFor(
    plan.orientation,
    panels.length,
    Math.max((availableHeight || 0) - headerSize.height, 0)
  )
  const width = plotWidthFor(
    plan.orientation,
    panels.length,
    plotAreaSize.width,
    colorActive
  )

  // Memoised because react-plotly.js compares `data`/`layout` by IDENTITY and
  // calls Plotly.react() whenever either differs. A figure rebuilt on every
  // render means a full re-plot of every panel on every keystroke in the rename
  // field — six traces of a thousand points each.
  const figure = useMemo(
    () =>
      panels.length && data
        ? buildFigure({
          plan,
          variablesByName,
          panels,
          sharedAxis,
          data,
          colorBy,
          colorscale,
          labels: customLabels,
          mode: plotType,
          size: { width, height },
          uirevision: `${inspectRecordID}|${uirevision}`
        })
        : null,
    [
      plan,
      variablesByName,
      panels,
      sharedAxis,
      data,
      colorBy,
      colorscale,
      customLabels,
      plotType,
      width,
      height,
      inspectRecordID,
      uirevision
    ]
  )

  const labelOf = (columnName) => labelFor(variablesByName.get(columnName))

  // The variable picker. Checkbox rows rather than Dropdown.Item, because
  // Dropdown.Item closes the menu on click (ui/Dropdown.jsx) and choosing
  // several variables means the menu has to stay open. The menu portals to
  // document.body with its own max-height, so however many variables a dataset
  // has, the list scrolls there and never inside the modal.
  const variablesToggleTitle = panels.length === 1
    ? shortLabelFor(variablesByName.get(panels[0]))
    : t('datasetPreviewPlotVariablesSelected', { count: panels.length })

  const panelPicker = (
    <div className='controlRow'>
      <span className='controlCaption'>{t('datasetPreviewPlotVariables')}</span>
      <Tooltip placement='right' content={panels.map(labelOf).join(', ')}>
        <span className='controlButtonWrap'>
          <DropdownButton className='dropdownButtonLeft' title={variablesToggleTitle}>
            {measurements.length === 0 && (
              <span className='dropdownEmptyNote'>
                {t('datasetPreviewPlotNoVariables')}
              </span>
            )}
            {measurements.map((variable) => (
              <label
                className='dropdown-item variablePickerRow'
                key={variable.columnName}
              >
                <input
                  type='checkbox'
                  checked={panels.includes(variable.columnName)}
                  onChange={() => togglePanel(variable.columnName)}
                />
                <span className='variablePickerLabel'>{labelFor(variable)}</span>
              </label>
            ))}
            {measurements.length > 1 && (
              <>
                <hr />
                <button
                  type='button'
                  className='dropdown-item'
                  onClick={() =>
                    setPanels(
                      panels.length === measurements.length
                        ? []
                        : measurements.map((variable) => variable.columnName)
                    )}
                >
                  {panels.length === measurements.length
                    ? t('datasetPreviewPlotSelectNone')
                    : t('datasetPreviewPlotSelectAll')}
                </button>
              </>
            )}
          </DropdownButton>
        </span>
      </Tooltip>
    </div>
  )

  // Single-select rows: the shared axis, and the optional colour dimension.
  const singleSelectRow = (captionKey, value, options, onPick, includeNone) => (
    <div className='controlRow'>
      <span className='controlCaption'>{t(captionKey)}</span>
      <Tooltip
        placement='right'
        content={value ? labelOf(value) : t('datasetPreviewPlotNone')}
      >
        <span className='controlButtonWrap'>
          <DropdownButton
            className='dropdownButtonLeft'
            title={
              value
                ? shortLabelFor(variablesByName.get(value))
                : t('datasetPreviewPlotNone')
            }
          >
            {includeNone && (
              <Dropdown.Item onClick={() => onPick(null)}>
                {t('datasetPreviewPlotNone')}
              </Dropdown.Item>
            )}
            {options.map((variable) => (
              <Dropdown.Item
                key={variable.columnName}
                active={variable.columnName === value}
                onClick={() => onPick(variable.columnName)}
              >
                {labelFor(variable)}
              </Dropdown.Item>
            ))}
          </DropdownButton>
        </span>
      </Tooltip>
    </div>
  )

  const colorscaleRow = (
    <div className='controlRow'>
      <span className='controlCaption'>{t('datasetPreviewPlotColorScale')}</span>
      <span className='controlButtonWrap'>
        <DropdownButton className='dropdownButtonLeft' title={colorscale}>
          {COLORSCALE_OPTIONS.map((name) => (
            <Dropdown.Item
              key={name}
              active={name === colorscale}
              onClick={() => setColorscale(name)}
            >
              {name}
            </Dropdown.Item>
          ))}
        </DropdownButton>
      </span>
    </div>
  )

  // A rename per drawn axis. Keyed by column name, not by axis role — with one
  // panel per variable there are no fixed roles left to key on.
  const renameRow = (columnName) => (
    <div className='labelEditorRow' key={columnName}>
      <label htmlFor={`rename-${columnName}`}>{labelOf(columnName)}</label>
      <input
        id={`rename-${columnName}`}
        type='text'
        value={customLabels[columnName] || ''}
        placeholder={shortLabelFor(variablesByName.get(columnName))}
        onChange={(event) =>
          setCustomLabels((previous) => ({
            ...previous,
            [columnName]: event.target.value
          }))}
      />
    </div>
  )

  const renameTargets = [sharedAxis, ...panels, colorBy].filter(Boolean)

  return (
    <div className='datasetPreviewControls'>
      <div className='datasetPreviewControlsColumn'>
        {panelPicker}
        {singleSelectRow(
          'datasetPreviewPlotSharedAxis',
          sharedAxis,
          sharedCandidates,
          (columnName) => columnName && setSharedAxis(columnName),
          false
        )}
        {singleSelectRow(
          'datasetPreviewPlotColorSelect',
          colorBy,
          measurements.concat(
            sharedCandidates.filter((variable) => variable.kind === 'coordinate')
          ),
          setColorBy,
          true
        )}

        <button
          type='button'
          className='labelEditorToggle'
          onClick={() => setShowLabels(!showLabels)}
        >
          {t('datasetPreviewPlotCustomizePlot')} {showLabels ? '▴' : '▾'}
        </button>
        {showLabels && (
          <div className='labelEditor'>
            {colorActive && colorscaleRow}
            {renameTargets.map(renameRow)}
          </div>
        )}
      </div>

      <div className='datasetPreviewPlotArea' ref={plotAreaRef}>
        <div className='datasetPreviewPlotHeader' ref={headerRef}>
          <DropdownButton
            className='dropdownButtonRight dropdownButton'
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
          {figure
            ? (
              <Plot
                data={figure.data}
                layout={figure.layout}
                // Explicit width/height in the layout, so Plotly never runs
                // plotAutoSize. That is what used to read a container height of
                // 0px on first mount and silently fall back to its own 450px
                // default, leaving the plot small until the next relayout.
                style={{ width: `${width}px`, height: `${height}px` }}
                useResizeHandler={false}
                config={{
                  displaylogo: false,
                  modeBarButtonsToRemove: [
                    'select2d',
                    'lasso2d',
                    'resetScale2d',
                    'pan2d'
                  ],
                  // Off deliberately: `responsive` re-measures from computed
                  // style on every window resize, which would fight the sizes
                  // above. useElementSize drives resizing instead.
                  responsive: false,
                  scrollZoom: true,
                  locale: i18n.language === 'fr' ? 'fr' : 'en'
                }}
              />
            )
            : (
              <p className='datasetPreviewPlotEmpty'>
                {t('datasetPreviewPlotNoVariablesSelected')}
              </p>
            )}
        </div>
      </div>
    </div>
  )
}
