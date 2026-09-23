import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dropdown, DropdownButton } from "../../ui/Dropdown.jsx";
import Tooltip from "../../ui/Tooltip.jsx";
import PaneDivider from "../../ui/PaneDivider.jsx";
import useElementSize from "../../ui/useElementSize.js";
import VariableColorPicker from "./VariableColorPicker.jsx";
import ColorScalePicker from "./ColorScalePicker.jsx";
import ColorScaleLegend from "./ColorScaleLegend.jsx";
import "./styles.css";

import Plotly from "plotly.js-basic-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import frLocale from "plotly.js-locales/fr";

import {
  labelFor,
  shortLabelFor,
  measurementsOf,
} from "../DatasetPreview/previewVariables.js";
import {
  axisDirectionsFor,
  sharedCandidatesFor,
} from "../DatasetPreview/previewFacetPlan.js";
import {
  boxBudgetFor,
  buildFigure,
  heightBudgetFor,
  plotHeightFor,
  plotWidthFor,
  recordTitleFor,
  titleLinesFor,
} from "../DatasetPreview/previewFacetFigure.js";
import {
  clampPaneWidth,
  PANE_DEFAULT_PX,
  PANE_MAX_PX,
  PANE_MIN_PX,
} from "../DatasetPreview/previewPaneLayout.js";
import { defaultColorFor } from "../DatasetPreview/previewColors.js";
import { autoScaleNameFor } from "../DatasetPreview/previewColorScales.js";

// Which key names each axis's direction, so the caption can say which way round
// this plot is drawn. See axisDirectionsFor.
const DIRECTION_LABELS = {
  vertical: "datasetPreviewPlotAxisVertical",
  horizontal: "datasetPreviewPlotAxisHorizontal",
};
const DIRECTION_GLYPHS = { vertical: "↕", horizontal: "↔" };

// t(plotType) would work for two of the three: there is no `markers+lines` key,
// only `markersAndLine`, so the toggle used to show the raw mode string.
const PLOT_MODE_LABELS = {
  markers: "markers",
  lines: "line",
  "markers+lines": "markersAndLine",
};

const PARAMS_PANE_ID = "datasetPreviewParamsPane";

Plotly.register(frLocale);
const Plot = createPlotlyComponent(Plotly);

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
export default function DatasetPreviewPlot({
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
  colorCandidates,
  colorAxis,
  setColorAxis,
  colorScale,
  setColorScale,
  plotType,
  setPlotType,
  customLabels,
  setCustomLabels,
  uirevision,
  // clientHeight of the scroll container the panes fill. The CEILING on the
  // plot's height — never the plot's own box on its own, which would be a
  // feedback loop. See heightBudgetFor for the other half.
  availableHeight,
  paneWidth,
  setPaneWidth,
}) {
  const { t, i18n } = useTranslation();
  // Purely local: a disclosure triangle is not worth a param, and nobody wants
  // to share which panel they had folded open.
  const [showLabels, setShowLabels] = useState(false);
  // Only for the cursor and the text-selection lock while a drag is live.
  const [resizing, setResizing] = useState(false);

  // The plot pane's own box. Its width is what the figure is drawn to; its
  // height enters only through heightBudgetFor, which can lower the ceiling
  // above but never raise it.
  const [plotAreaRef, plotAreaSize] = useElementSize();
  const measurements = measurementsOf(variables);
  const sharedCandidates = sharedCandidatesFor(variables);
  const directions = axisDirectionsFor(plan.orientation);

  // What names the record, and therefore what the figure is titled. Computed
  // here as well as inside buildFigure because the title's height is part of the
  // budget below — and it can be, without a loop: the width does not depend on
  // the title, so the line count is known before the height is chosen.
  const title = useMemo(
    () => recordTitleFor({ plan, variablesByName, data }),
    [plan, variablesByName, data],
  );
  const width = plotWidthFor(
    plan.orientation,
    panels.length,
    boxBudgetFor(plotAreaSize.width),
  );
  // The lines the title really wraps to, not the two-line worst case the sizing
  // helpers assume on their own: at a short scroller that is the difference
  // between three stacked panels fitting and scrolling.
  const titleLines = titleLinesFor(title, width);
  // The whole pane: with the plot-type control moved into the parameters pane
  // there is nothing above the figure to subtract.
  const height = plotHeightFor(
    plan.orientation,
    panels.length,
    heightBudgetFor(availableHeight, plotAreaSize.height),
    titleLines,
  );

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
            colorAxis,
            colorScale,
            size: { width, height },
            uirevision: `${inspectRecordID}|${uirevision}`,
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
      colorAxis,
      colorScale,
      width,
      height,
      inspectRecordID,
      uirevision,
    ],
  );

  const labelOf = (columnName) => labelFor(variablesByName.get(columnName));

  // "X axis ↕" — the name says which axis, the glyph says which way this plot
  // draws it. Labelled rather than aria-hidden: ui/Tooltip portals its bubble
  // with no aria-describedby, so a tooltip here would never be announced.
  const axisCaption = (key, direction) => (
    <span className="controlCaption">
      {t(key)}{" "}
      <span
        className="controlCaptionDirection"
        role="img"
        aria-label={t(DIRECTION_LABELS[direction])}
      >
        {DIRECTION_GLYPHS[direction]}
      </span>
    </span>
  );

  // .dropdown .btn is inline-flex, so a bare string becomes an anonymous flex
  // item that text-overflow cannot reach and min-width: auto will not shrink.
  const toggleLabel = (text) => (
    <span className="dropdownToggleLabel">{text}</span>
  );

  // The variable picker. Checkbox rows rather than Dropdown.Item, because
  // Dropdown.Item closes the menu on click (ui/Dropdown.jsx) and choosing
  // several variables means the menu has to stay open. The menu portals to
  // document.body with its own max-height, so however many variables a dataset
  // has, the list scrolls there and never inside the modal.
  const variablesToggleTitle =
    panels.length === 1
      ? shortLabelFor(variablesByName.get(panels[0]))
      : t("datasetPreviewPlotVariablesSelected", { count: panels.length });

  const panelPicker = (
    <div className="controlRow">
      {axisCaption("datasetPreviewPlotYAxis", directions.y)}
      <Tooltip placement="right" content={panels.map(labelOf).join(", ")}>
        <span className="controlButtonWrap">
          <DropdownButton
            className="dropdownButtonLeft"
            title={toggleLabel(variablesToggleTitle)}
          >
            {measurements.length === 0 && (
              <span className="dropdownEmptyNote">
                {t("datasetPreviewPlotNoVariables")}
              </span>
            )}
            {measurements.map((variable) => (
              <label
                className="dropdown-item variablePickerRow"
                key={variable.columnName}
              >
                <input
                  type="checkbox"
                  checked={panels.includes(variable.columnName)}
                  onChange={() => togglePanel(variable.columnName)}
                />
                <span className="variablePickerLabel">
                  {labelFor(variable)}
                </span>
              </label>
            ))}
            {measurements.length > 1 && (
              <>
                <hr />
                <button
                  type="button"
                  className="dropdown-item"
                  onClick={() =>
                    setPanels(
                      panels.length === measurements.length
                        ? []
                        : measurements.map((variable) => variable.columnName),
                    )
                  }
                >
                  {panels.length === measurements.length
                    ? t("datasetPreviewPlotSelectNone")
                    : t("datasetPreviewPlotSelectAll")}
                </button>
              </>
            )}
          </DropdownButton>
        </span>
      </Tooltip>
    </div>
  );

  // Plot type. First in the pane deliberately: it is the one control that
  // changes every panel at once, and it used to sit alone in a row above the
  // figure, which cost the figure that row's height for one dropdown.
  const plotTypeRow = (
    <div className="controlRow">
      <span className="controlCaption">{t("plotType")}</span>
      <span className="controlButtonWrap">
        <DropdownButton
          className="dropdownButtonLeft"
          title={toggleLabel(t(PLOT_MODE_LABELS[plotType]))}
        >
          <Dropdown.Item
            active={plotType === "markers"}
            onClick={() => setPlotType("markers")}
          >
            {t("markers")}
          </Dropdown.Item>
          <Dropdown.Item
            active={plotType === "lines"}
            onClick={() => setPlotType("lines")}
          >
            {t("line")}
          </Dropdown.Item>
          <Dropdown.Item
            active={plotType === "markers+lines"}
            onClick={() => setPlotType("markers+lines")}
          >
            {t("markersAndLine")}
          </Dropdown.Item>
        </DropdownButton>
      </span>
    </div>
  );

  // The one axis every panel is drawn against. There used to be a second
  // dropdown of this shape — "Color by", one variable whose values shaded every
  // panel — and this was a factory over the two; the colour of a variable is now
  // the variable's own, picked beside its name in the panel below.
  const sharedAxisRow = (
    <div className="controlRow">
      {axisCaption("datasetPreviewPlotXAxis", directions.x)}
      <Tooltip placement="right" content={labelOf(sharedAxis)}>
        <span className="controlButtonWrap">
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
        </span>
      </Tooltip>
    </div>
  );

  // The third dimension. No direction glyph beside the caption: colour has no
  // direction, and reusing axisCaption here would imply it was a third axis
  // rather than a shading of the two the panels already have.
  const colorByRow = (
    <div className="controlRow">
      <span className="controlCaption">{t("datasetPreviewPlotColorBy")}</span>
      <Tooltip
        placement="right"
        content={
          colorAxis ? labelOf(colorAxis) : t("datasetPreviewPlotColorNone")
        }
      >
        <span className="controlButtonWrap">
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
        </span>
      </Tooltip>
    </div>
  );

  // Only while there is something to scale.
  const colorScaleRow = colorAxis && (
    <div className="controlRow">
      <span className="controlCaption">
        {t("datasetPreviewPlotColorScale")}
      </span>
      <span className="controlButtonWrap">
        <ColorScalePicker
          value={colorScale}
          autoName={autoScaleNameFor(variablesByName.get(colorAxis))}
          onPick={setColorScale}
        />
      </span>
    </div>
  );

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
        {plotTypeRow}
        {sharedAxisRow}
        {panelPicker}
        {colorByRow}
        {colorScaleRow}

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
