import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dropdown, DropdownButton } from '../../ui/Dropdown.jsx'
import Tooltip from '../../ui/Tooltip.jsx'
import useElementSize from '../../ui/useElementSize.js'
import VariableColorPicker from './VariableColorPicker.jsx'
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
  plotWidthFor,
  recordTitleFor,
  titleLinesFor
} from '../DatasetPreview/previewFacetFigure.js'
import { defaultColorFor } from '../DatasetPreview/previewColors.js'

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
// axes, the plot type and the colours all used to get silently discarded.
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
  variableColors,
  setVariableColor,
  plotType,
  setPlotType,
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
  const measurements = measurementsOf(variables)
  const sharedCandidates = sharedCandidatesFor(variables)

  // What names the record, and therefore what the figure is titled. Computed
  // here as well as inside buildFigure because the title's height is part of the
  // budget below — and it can be, without a loop: the width does not depend on
  // the title, so the line count is known before the height is chosen.
  const title = useMemo(
    () => recordTitleFor({ plan, variablesByName, data }),
    [plan, variablesByName, data]
  )
  const width = plotWidthFor(plan.orientation, panels.length, plotAreaSize.width)
  // The lines the title really wraps to, not the two-line worst case the sizing
  // helpers assume on their own: at a short scroller that is the difference
  // between three stacked panels fitting and scrolling.
  const titleLines = titleLinesFor(title, width)
  // The whole scroller: with the plot-type control moved into the left column
  // there is nothing above the figure to subtract.
  const height = plotHeightFor(
    plan.orientation,
    panels.length,
    availableHeight || 0,
    titleLines
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
          colors: variableColors,
          labels: customLabels,
          title,
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
      variableColors,
      customLabels,
      title,
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

  // Plot type. First in the column deliberately: it is the one control that
  // changes every panel at once, and it used to sit alone in a row above the
  // figure, which cost the figure that row's height for one dropdown.
  const plotTypeRow = (
    <div className='controlRow'>
      <span className='controlCaption'>{t('plotType')}</span>
      <span className='controlButtonWrap'>
        <DropdownButton className='dropdownButtonLeft' title={t(plotType)}>
          <Dropdown.Item
            active={plotType === 'markers'}
            onClick={() => setPlotType('markers')}
          >
            {t('markers')}
          </Dropdown.Item>
          <Dropdown.Item
            active={plotType === 'lines'}
            onClick={() => setPlotType('lines')}
          >
            {t('line')}
          </Dropdown.Item>
          <Dropdown.Item
            active={plotType === 'markers+lines'}
            onClick={() => setPlotType('markers+lines')}
          >
            {t('markersAndLine')}
          </Dropdown.Item>
        </DropdownButton>
      </span>
    </div>
  )

  // The one axis every panel is drawn against. There used to be a second
  // dropdown of this shape — "Color by", one variable whose values shaded every
  // panel — and this was a factory over the two; the colour of a variable is now
  // the variable's own, picked beside its name in the panel below.
  const sharedAxisRow = (
    <div className='controlRow'>
      <span className='controlCaption'>
        {t('datasetPreviewPlotSharedAxis')}
      </span>
      <Tooltip placement='right' content={labelOf(sharedAxis)}>
        <span className='controlButtonWrap'>
          <DropdownButton
            className='dropdownButtonLeft'
            title={shortLabelFor(variablesByName.get(sharedAxis))}
          >
            {sharedCandidates.map((variable) => (
              <Dropdown.Item
                key={variable.columnName}
                active={variable.columnName === sharedAxis}
                onClick={() => setSharedAxis(variable.columnName)}
              >
                {labelFor(variable)}
              </Dropdown.Item>
            ))}
          </DropdownButton>
        </span>
      </Tooltip>
    </div>
  )

  // Per-variable customisation, keyed by column name — with one panel per
  // variable there are no fixed axis roles left to key on. A panel gets its
  // colour as well as its name; the shared axis draws no trace, so it gets only
  // the name.
  const customizeRow = (columnName, index) => (
    <div className='labelEditorRow' key={columnName}>
      <label htmlFor={`rename-${columnName}`}>{labelOf(columnName)}</label>
      <div className='labelEditorControls'>
        {index !== null && (
          <VariableColorPicker
            color={variableColors[columnName] || null}
            defaultColor={defaultColorFor(
              variablesByName.get(columnName),
              index
            )}
            onPick={(color) => setVariableColor(columnName, color)}
            label={`${t('datasetPreviewPlotColor')}: ${labelOf(columnName)}`}
          />
        )}
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
    </div>
  )

  return (
    <div className='datasetPreviewControls'>
      <div className='datasetPreviewControlsColumn'>
        {plotTypeRow}
        {panelPicker}
        {sharedAxisRow}

        <button
          type='button'
          className='labelEditorToggle'
          onClick={() => setShowLabels(!showLabels)}
        >
          {t('datasetPreviewPlotCustomizePlot')} {showLabels ? '▴' : '▾'}
        </button>
        {showLabels && (
          <div className='labelEditor'>
            {sharedAxis && customizeRow(sharedAxis, null)}
            {panels.map((columnName, index) => customizeRow(columnName, index))}
          </div>
        )}
      </div>

      <div className='datasetPreviewPlotArea' ref={plotAreaRef}>
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
