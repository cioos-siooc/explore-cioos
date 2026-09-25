import * as React from "react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dropdown, DropdownButton } from "../../ui/Dropdown.jsx";
import PaneDivider from "../../ui/PaneDivider.jsx";
import useElementSize from "../../ui/useElementSize.js";
import ControlRow from "./ControlRow.jsx";
import VariablePicker from "./VariablePicker.jsx";
import VariableColorPicker from "./VariableColorPicker.jsx";
import ColorScalePicker from "./ColorScalePicker.jsx";
import ColorScaleLegend from "./ColorScaleLegend.jsx";
import ProfileSlice from "./ProfileSlice.jsx";
import "./styles.css";

import Plotly from "plotly.js-basic-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import frLocale from "plotly.js-locales/fr";

import { labelFor, shortLabelFor } from "../DatasetPreview/previewVariables.js";
import {
  axisDirectionsFor,
  panelCandidatesFor,
  sharedCandidatesFor,
} from "../DatasetPreview/previewFacetPlan.js";
import {
  buildFigure,
  plotBoxFor,
} from "../DatasetPreview/previewFacetFigure.js";
import {
  clampPaneWidth,
  PANE_DEFAULT_PX,
  PANE_MAX_PX,
  PANE_MIN_PX,
} from "../DatasetPreview/previewPaneLayout.js";
import { defaultColorFor } from "../DatasetPreview/previewColors.js";
import { autoScaleNameFor } from "../DatasetPreview/previewColorScales.js";
import { POSITION_INDEX_COLUMN } from "../DatasetPreview/previewTrackIndex.js";
import { PLOT_MODES } from "../DatasetPreview/usePreviewPlotParams.js";
import { usePreviewPlot } from "../DatasetPreview/PreviewPlotProvider.jsx";

const PARAMS_PANE_ID = "datasetPreviewParamsPane";

Plotly.register(frLocale);
const Plot = createPlotlyComponent(Plotly);

// One panel per variable, all sharing one axis. The arrangement per
// cdm_data_type lives in previewFacetPlan.js, the box in previewFacetSizing.js
// and the figure in previewFacetFigure.js — all pure, so the layout is testable
// without a browser. This file is the controls.
//
// Everything describing the plot comes from PreviewPlotProvider: it is held
// above this component because this one is unmounted every time the user flips
// to the Table and back.
export default function DatasetPreviewPlot() {
  const { t, i18n } = useTranslation();
  const {
    inspectRecordID,
    plotData,
    trackIndex,
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
    colorCandidates,
    colorAxis,
    setColorAxis,
    colorScale,
    setColorScale,
    plotType,
    setPlotType,
    profiles,
    step,
    setStep,
    customLabels,
    setCustomLabels,
    uirevision,
    availableHeight,
    paneWidth,
    setPaneWidth,
  } = usePreviewPlot();

  // Purely local: a disclosure triangle is not worth a param, and nobody wants
  // to share which panel they had folded open.
  const [showLabels, setShowLabels] = useState(false);
  // Only for the cursor and the text-selection lock while a drag is live.
  const [resizing, setResizing] = useState(false);

  // The plot pane's own box. Its width is what the figure is drawn to; its
  // height enters only through plotBoxFor, which can lower the ceiling that
  // availableHeight sets but never raise it.
  const [plotAreaRef, plotAreaSize] = useElementSize();
  const panelChoices = panelCandidatesFor(variables, sharedAxis);
  const sharedCandidates = sharedCandidatesFor(variables);
  const directions = axisDirectionsFor(plan.orientation);
  const axisCaptionFor = (direction) =>
    direction === "horizontal"
      ? t("datasetPreviewPlotXAxis")
      : t("datasetPreviewPlotYAxis");

  // The figure's box and the title that shapes it. One call because the three
  // have to be derived in that order — see plotBoxFor.
  const { title, width, height } = useMemo(
    () =>
      plotBoxFor({
        plan,
        variablesByName,
        data: plotData,
        panelCount: panels.length,
        availableHeight,
        measured: plotAreaSize,
      }),
    [
      plan,
      variablesByName,
      plotData,
      panels.length,
      availableHeight,
      plotAreaSize,
    ],
  );

  // The ticks and the position labels belong to the index and to nothing else:
  // switch the axis back to longitude and they would label the wrong numbers.
  const onPositionAxis = Boolean(
    trackIndex && sharedAxis === POSITION_INDEX_COLUMN,
  );

  // Memoised because react-plotly.js compares `data`/`layout` by IDENTITY and
  // calls Plotly.react() whenever either differs. A figure rebuilt on every
  // render means a full re-plot of every panel on every keystroke in the rename
  // field — six traces of a thousand points each.
  const figure = useMemo(
    () =>
      panels.length && plotData
        ? buildFigure({
            plan,
            variablesByName,
            panels,
            sharedAxis,
            data: plotData,
            colors: variableColors,
            labels: customLabels,
            title,
            mode: plotType,
            colorAxis,
            colorScale,
            sharedTicks: onPositionAxis ? trackIndex.ticks : null,
            sharedText: onPositionAxis ? trackIndex.labels : null,
            size: { width, height },
            uirevision: `${inspectRecordID}|${uirevision}`,
          })
        : null,
    [
      plan,
      variablesByName,
      panels,
      sharedAxis,
      plotData,
      variableColors,
      customLabels,
      title,
      plotType,
      colorAxis,
      colorScale,
      onPositionAxis,
      trackIndex,
      width,
      height,
      inspectRecordID,
      uirevision,
    ],
  );

  const labelOf = (columnName) => labelFor(variablesByName.get(columnName));
  const toggleLabel = (text) => (
    <span className="dropdownToggleLabel">{text}</span>
  );
  const activeMode =
    PLOT_MODES.find((mode) => mode.value === plotType) || PLOT_MODES[0];

  // Per-variable customisation, keyed by column name — with one panel per
  // variable there are no fixed axis roles left to key on. A panel gets its
  // colour as well as its name; the shared axis draws no trace, so it gets only
  // the name.
  const customizeRow = (columnName, index) => (
    <div className="labelEditorRow" key={columnName}>
      <label htmlFor={`rename-${columnName}`}>{labelOf(columnName)}</label>
      <div className="labelEditorControls">
        {index !== null && (
          <VariableColorPicker
            color={variableColors[columnName] || null}
            defaultColor={defaultColorFor(
              variablesByName.get(columnName),
              index,
            )}
            onPick={(color) => setVariableColor(columnName, color)}
            label={`${t("datasetPreviewPlotColor")}: ${labelOf(columnName)}`}
          />
        )}
        <input
          id={`rename-${columnName}`}
          type="text"
          value={customLabels[columnName] || ""}
          placeholder={shortLabelFor(variablesByName.get(columnName))}
          onChange={(event) =>
            setCustomLabels((previous) => ({
              ...previous,
              [columnName]: event.target.value,
            }))
          }
        />
      </div>
    </div>
  );

  const bounds = { paneWidth, plotWidth: plotAreaSize.width };

  return (
    <div
      className={
        resizing
          ? "datasetPreviewPlotPanes isResizing"
          : "datasetPreviewPlotPanes"
      }
    >
      <div
        className="datasetPreviewParamsPane"
        id={PARAMS_PANE_ID}
        style={{ width: paneWidth }}
      >
        {/* First in the pane deliberately: it is the one control that changes
            every panel at once. */}
        <ControlRow caption={t("plotType")}>
          <DropdownButton
            className="dropdownButtonLeft"
            data-testid="preview-mode-dropdown"
            title={toggleLabel(t(activeMode.labelKey))}
          >
            {PLOT_MODES.map(({ value, labelKey }) => (
              <Dropdown.Item
                key={value}
                data-testid="preview-mode-option"
                active={plotType === value}
                onClick={() => setPlotType(value)}
              >
                {t(labelKey)}
              </Dropdown.Item>
            ))}
          </DropdownButton>
        </ControlRow>

        <ControlRow
          caption={axisCaptionFor(directions.x)}
          tooltip={labelOf(sharedAxis)}
        >
          <DropdownButton
            className="dropdownButtonLeft"
            title={toggleLabel(shortLabelFor(variablesByName.get(sharedAxis)))}
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
        </ControlRow>

        <ControlRow
          caption={axisCaptionFor(directions.y)}
          hint={t("datasetPreviewPlotAddRemovePlots")}
          tooltip={panels.map(labelOf).join(", ")}
        >
          <VariablePicker
            choices={panelChoices}
            panels={panels}
            variablesByName={variablesByName}
            togglePanel={togglePanel}
            setPanels={setPanels}
          />
        </ControlRow>

        <ControlRow
          caption={t("datasetPreviewPlotColorBy")}
          tooltip={
            colorAxis ? labelOf(colorAxis) : t("datasetPreviewPlotColorNone")
          }
        >
          <DropdownButton
            className="dropdownButtonLeft"
            title={toggleLabel(
              colorAxis
                ? shortLabelFor(variablesByName.get(colorAxis))
                : t("datasetPreviewPlotColorNone"),
            )}
          >
            <Dropdown.Item
              active={!colorAxis}
              onClick={() => setColorAxis(null)}
            >
              {t("datasetPreviewPlotColorNone")}
            </Dropdown.Item>
            {colorCandidates.map((variable) => (
              <Dropdown.Item
                key={variable.columnName}
                active={variable.columnName === colorAxis}
                onClick={() => setColorAxis(variable.columnName)}
              >
                {labelFor(variable)}
              </Dropdown.Item>
            ))}
          </DropdownButton>
        </ControlRow>

        {colorAxis && (
          <ControlRow caption={t("datasetPreviewPlotColorScale")}>
            <ColorScalePicker
              value={colorScale}
              autoName={autoScaleNameFor(variablesByName.get(colorAxis))}
              onPick={setColorScale}
            />
          </ControlRow>
        )}

        <button
          type="button"
          className="labelEditorToggle"
          onClick={() => setShowLabels(!showLabels)}
        >
          {t("datasetPreviewPlotCustomizePlot")} {showLabels ? "▴" : "▾"}
        </button>
        {showLabels && (
          <div className="labelEditor">
            {sharedAxis && customizeRow(sharedAxis, null)}
            {panels.map((columnName, index) => customizeRow(columnName, index))}
          </div>
        )}
      </div>

      <PaneDivider
        label={t("datasetPreviewPlotResizeParams")}
        controls={PARAMS_PANE_ID}
        value={paneWidth}
        min={PANE_MIN_PX}
        max={clampPaneWidth(PANE_MAX_PX, bounds)}
        reset={PANE_DEFAULT_PX}
        onChange={(next) => setPaneWidth(clampPaneWidth(next, bounds))}
        onDragChange={setResizing}
      />

      <div className="datasetPreviewPlotColumn">
        {/* Above the figure rather than in the parameters pane: this says WHICH
            rows are drawn where every control in the pane says how, and the
            pane is too narrow to read a cast's date in. */}
        <ProfileSlice profiles={profiles} step={step} setStep={setStep} />

        {/* Above the scroller, not inside it: a profile wide enough to scroll
            is exactly the plot whose scale would otherwise be off-screen. */}
        <ColorScaleLegend legend={figure && figure.colorLegend} />

        <div className="datasetPreviewPlotArea" ref={plotAreaRef}>
          {figure ? (
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
                  "select2d",
                  "lasso2d",
                  "resetScale2d",
                  "pan2d",
                ],
                // Off deliberately: `responsive` re-measures from computed
                // style on every window resize, which would fight the sizes
                // above. useElementSize drives resizing instead.
                responsive: false,
                scrollZoom: true,
                locale: i18n.language === "fr" ? "fr" : "en",
              }}
            />
          ) : (
            <p className="datasetPreviewPlotEmpty">
              {t("datasetPreviewPlotNoVariablesSelected")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
