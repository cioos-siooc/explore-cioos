import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dropdown, DropdownButton } from "../../ui/Dropdown.jsx";
import Tooltip from "../../ui/Tooltip.jsx";
import useElementSize from "../../ui/useElementSize.js";
import VariableColorPicker from "./VariableColorPicker.jsx";
import "./styles.css";

import Plotly from "plotly.js-basic-dist-min";
import createPlotlyComponent from "react-plotly.js/factory";
import frLocale from "plotly.js-locales/fr";

import {
  labelFor,
  shortLabelFor,
  measurementsOf,
} from "../DatasetPreview/previewVariables.js";
import { sharedCandidatesFor } from "../DatasetPreview/previewFacetPlan.js";
import {
  buildFigure,
  plotHeightFor,
  plotWidthFor,
  recordTitleFor,
  titleLinesFor,
} from "../DatasetPreview/previewFacetFigure.js";
import { defaultColorFor } from "../DatasetPreview/previewColors.js";

Plotly.register(frLocale);
const Plot = createPlotlyComponent(Plotly);

// Controls and sizing only; layout and figure are pure in previewFacetPlan.js /
// previewFacetFigure.js. All plot state is owned by DatasetPreview because this
// component unmounts on every Table/Plot flip.
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
  plotType,
  setPlotType,
  customLabels,
  setCustomLabels,
  uirevision,
  // An input to the plot's height, never the plot's own box (feedback loop).
  availableHeight,
}) {
  const { t, i18n } = useTranslation();
  // Purely local: which panel is folded open is not worth sharing in a link.
  const [showLabels, setShowLabels] = useState(false);

  const [plotAreaRef, plotAreaSize] = useElementSize();
  const measurements = measurementsOf(variables);
  const sharedCandidates = sharedCandidatesFor(variables);

  // Computed here too because the title's height is part of the budget; no loop,
  // as the width does not depend on the title.
  const title = useMemo(
    () => recordTitleFor({ plan, variablesByName, data }),
    [plan, variablesByName, data],
  );
  const width = plotWidthFor(
    plan.orientation,
    panels.length,
    plotAreaSize.width,
  );
  // The actual line count, not the worst case: at a short scroller that decides
  // whether three stacked panels fit.
  const titleLines = titleLinesFor(title, width);
  const height = plotHeightFor(
    plan.orientation,
    panels.length,
    availableHeight || 0,
    titleLines,
  );

  // react-plotly.js re-plots whenever `data`/`layout` identity changes, e.g. on
  // every keystroke in the rename field.
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
      width,
      height,
      inspectRecordID,
      uirevision,
    ],
  );

  const labelOf = (columnName) => labelFor(variablesByName.get(columnName));

  // Checkbox rows, not Dropdown.Item: an Item closes the menu on click, and
  // choosing several variables needs it open.
  const variablesToggleTitle =
    panels.length === 1
      ? shortLabelFor(variablesByName.get(panels[0]))
      : t("datasetPreviewPlotVariablesSelected", { count: panels.length });

  const panelPicker = (
    <div className="controlRow">
      <span className="controlCaption">{t("datasetPreviewPlotVariables")}</span>
      <Tooltip placement="right" content={panels.map(labelOf).join(", ")}>
        <span className="controlButtonWrap">
          <DropdownButton
            className="dropdownButtonLeft"
            title={variablesToggleTitle}
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

  // First: it is the one control that changes every panel at once.
  const plotTypeRow = (
    <div className="controlRow">
      <span className="controlCaption">{t("plotType")}</span>
      <span className="controlButtonWrap">
        <DropdownButton className="dropdownButtonLeft" title={t(plotType)}>
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

  const sharedAxisRow = (
    <div className="controlRow">
      <span className="controlCaption">
        {t("datasetPreviewPlotSharedAxis")}
      </span>
      <Tooltip placement="right" content={labelOf(sharedAxis)}>
        <span className="controlButtonWrap">
          <DropdownButton
            className="dropdownButtonLeft"
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
  );

  // The shared axis draws no trace, so it gets a name but no colour.
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

  return (
    <div className="datasetPreviewControls">
      <div className="datasetPreviewControlsColumn">
        {plotTypeRow}
        {panelPicker}
        {sharedAxisRow}

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

      <div className="datasetPreviewPlotArea" ref={plotAreaRef}>
        <div className="datasetPreviewPlot">
          {figure ? (
            <Plot
              data={figure.data}
              layout={figure.layout}
              // Explicit width/height so Plotly never runs plotAutoSize, which
              // reads 0px on first mount and falls back to 450px.
              style={{ width: `${width}px`, height: `${height}px` }}
              useResizeHandler={false}
              config={{
                displaylogo: false,
                // Plotly 4 defaults this on; it posts the chart to cloud.plotly.com.
                showSendToCloud: false,
                modeBarButtonsToRemove: [
                  "select2d",
                  "lasso2d",
                  "resetScale2d",
                  "pan2d",
                ],
                // Off: `responsive` would fight the sizes above;
                // useElementSize drives resizing instead.
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
