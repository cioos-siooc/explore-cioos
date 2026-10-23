import * as React from "react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronBarLeft,
  ChevronBarRight,
  QuestionCircle,
} from "react-bootstrap-icons";
import { Dropdown, DropdownButton } from "../../ui/Dropdown.jsx";
import HelpModal from "../../ui/HelpModal.jsx";
import PaneDivider from "../../ui/PaneDivider.jsx";
import useElementSize from "../../ui/useElementSize.js";
import ControlRow from "./ControlRow.jsx";
import VariablePicker from "./VariablePicker.jsx";
import VariableColorPicker from "./VariableColorPicker.jsx";
import ColorScalePicker from "./ColorScalePicker.jsx";
import ColorScaleLegend from "./ColorScaleLegend.jsx";
import ProfileSlice from "./ProfileSlice.jsx";
import "./styles.css";

import Plotly from "./previewPlotly.js";
import createPlotlyComponent from "react-plotly.js/factory";
import isEqual from "lodash-es/isEqual";

import { labelFor, shortLabelFor } from "../DatasetPreview/previewVariables.js";
import {
  axisDirectionsFor,
  panelCandidatesFor,
  sharedCandidatesFor,
  COLUMNS,
  ROWS,
} from "../DatasetPreview/previewFacetPlan.js";
import {
  buildColorFigure,
  buildFigure,
  plotBoxFor,
} from "../DatasetPreview/previewFacetFigure.js";
import { pinnedAxisSizeFor } from "../DatasetPreview/previewFacetSizing.js";
import {
  pinnedAxisFigureFor,
  pinnedViewFor,
  splitPinnedAxis,
} from "../DatasetPreview/previewPinnedAxis.js";
import { exportFigureFor } from "../DatasetPreview/previewExportFigure.js";
import {
  clampPaneWidth,
  PANE_DEFAULT_PX,
  PANE_MAX_PX,
  PANE_MIN_PX,
} from "../DatasetPreview/previewPaneLayout.js";
import { defaultColorFor } from "../DatasetPreview/previewColors.js";
import { autoScaleNameFor } from "../DatasetPreview/previewColorScales.js";
import { POSITION_INDEX_COLUMN } from "../DatasetPreview/previewTrackIndex.js";
import {
  MAX_COLOR_PANELS,
  PLOT_LAYOUTS,
  PLOT_MODES,
} from "../DatasetPreview/usePreviewPlotParams.js";
import { usePreviewPlot } from "../DatasetPreview/PreviewPlotProvider.jsx";

const PARAMS_PANE_ID = "datasetPreviewParamsPane";
// Records holding many casts: named in a header row beside the cast slider
// instead of in the figure's own title.
const PROFILE_RECORD_TYPES = ["TimeSeriesProfile", "TrajectoryProfile"];

const Plot = createPlotlyComponent(Plotly);

const PINNED_AXIS_CONFIG = { staticPlot: true, displayModeBar: false };

// Controls only; layout, box and figure are pure in previewFacetPlan.js /
// previewFacetSizing.js / previewFacetFigure.js. All plot state comes from
// PreviewPlotProvider because this component unmounts on every Table/Plot flip.
export default function DatasetPreviewPlot() {
  const { t, i18n } = useTranslation();
  const {
    inspectDataset,
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
    plotLayout,
    setPlotLayout,
    colorPlotAvailable,
    colorX,
    setColorX,
    colorY,
    setColorY,
    variableScales,
    setVariableScale,
    yAxisColumns,
    reversedYAxes,
    setYAxisReversed,
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
    paneCollapsed,
    setPaneCollapsed,
  } = usePreviewPlot();

  // Purely local: which panel is folded open is not worth sharing in a link.
  const [showLabels, setShowLabels] = useState(false);
  // Only for the cursor and the text-selection lock while a drag is live.
  const [resizing, setResizing] = useState(false);

  // The plot pane's own box. Its width is what the figure is drawn to; its
  // height enters only through plotBoxFor, which can lower the ceiling that
  // availableHeight sets but never raise it.
  const [plotAreaRef, plotAreaSize] = useElementSize();
  const panelChoices = panelCandidatesFor(
    variables,
    sharedAxis,
    inspectDataset,
  );
  const sharedCandidates = sharedCandidatesFor(variables, inspectDataset);
  const directions = axisDirectionsFor(plan.orientation);
  const hasProfileHeader = PROFILE_RECORD_TYPES.includes(
    inspectDataset?.cdm_data_type,
  );
  const isColorLayout = plotLayout === "color";
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
        withTitle: !hasProfileHeader,
        orientation: isColorLayout ? ROWS : plan.orientation,
      }),
    [
      plan,
      variablesByName,
      plotData,
      panels.length,
      availableHeight,
      plotAreaSize,
      hasProfileHeader,
      isColorLayout,
    ],
  );

  // The ticks and the position labels belong to the index and to nothing else:
  // switch the axis back to longitude and they would label the wrong numbers.
  const onPositionAxis = Boolean(
    trackIndex &&
    (isColorLayout ? colorX : sharedAxis) === POSITION_INDEX_COLUMN,
  );

  // react-plotly.js re-plots whenever `data`/`layout` identity changes, e.g. on
  // every keystroke in the rename field.
  const figure = useMemo(() => {
    if (!panels.length || !plotData) return null;
    if (isColorLayout) {
      return colorX && colorY
        ? buildColorFigure({
            variablesByName,
            panels,
            xAxis: colorX,
            yAxis: colorY,
            data: plotData,
            labels: customLabels,
            scales: variableScales,
            title,
            sharedTicks: onPositionAxis ? trackIndex.ticks : null,
            sharedText: onPositionAxis ? trackIndex.labels : null,
            size: { width, height },
            uirevision: `${inspectRecordID}|${uirevision}`,
            yReversed: reversedYAxes.has(colorY),
          })
        : null;
    }
    return buildFigure({
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
      reversedYAxes,
    });
  }, [
    isColorLayout,
    colorX,
    colorY,
    variableScales,
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
    reversedYAxes,
  ]);

  // The shared axis leaves the scroller for a strip beside it, so its scale and
  // title stay in view while the panels scroll — see previewPinnedAxis.js.
  const pinnedOrientation = isColorLayout ? ROWS : plan.orientation;
  const split = useMemo(
    () => figure && splitPinnedAxis(figure, pinnedOrientation),
    [figure, pinnedOrientation],
  );
  const [pinnedView, setPinnedView] = useState(null);
  const [showInteractionHelp, setShowInteractionHelp] = useState(false);
  // Fired after every draw and every zoom; the main Plot redraws on each render
  // (its config is a fresh object), so an unchanged view must not re-render.
  const readPinnedView = useCallback(
    (_figure, graphDiv) => {
      const next = pinnedViewFor(graphDiv._fullLayout, pinnedOrientation);
      setPinnedView((previous) => (isEqual(previous, next) ? previous : next));
    },
    [pinnedOrientation],
  );
  const pinnedFigure = useMemo(
    () =>
      split && pinnedView
        ? pinnedAxisFigureFor(split.axis, pinnedView, pinnedOrientation)
        : null,
    [split, pinnedView, pinnedOrientation],
  );
  const downloadPng = (graphDiv) => {
    const exported = exportFigureFor({
      data: graphDiv.data,
      layout: graphDiv.layout,
      pinnedAxis: split.axis,
      orientation: pinnedOrientation,
      colorLegend: figure.colorLegend,
    });
    Plotly.downloadImage(
      { data: exported.data, layout: exported.layout },
      { format: "png", width: exported.width, height: exported.height },
    );
  };
  const pinnedThickness = pinnedAxisSizeFor(pinnedOrientation);
  const pinnedLeft = pinnedOrientation === COLUMNS;

  const labelOf = (columnName) => labelFor(variablesByName.get(columnName));
  const toggleLabel = (text) => (
    <span className="dropdownToggleLabel">{text}</span>
  );
  const activeMode =
    PLOT_MODES.find((mode) => mode.value === plotType) || PLOT_MODES[0];
  const activeLayout =
    PLOT_LAYOUTS.find((layout) => layout.value === plotLayout) ||
    PLOT_LAYOUTS[0];

  // A dropdown of single picks, for the axes. `excluded` keeps X and Y apart.
  const axisDropdown = (selected, onSelect, excluded) => (
    <DropdownButton
      className="dropdownButtonLeft"
      title={toggleLabel(shortLabelFor(variablesByName.get(selected)))}
    >
      {sharedCandidates
        .filter((variable) => variable.columnName !== excluded)
        .map((variable) => (
          <Dropdown.Item
            key={variable.columnName}
            active={variable.columnName === selected}
            onClick={() => onSelect(variable.columnName)}
          >
            {labelFor(variable)}
          </Dropdown.Item>
        ))}
    </DropdownButton>
  );

  // The shared axis draws no trace, so it gets a name but no colour.
  const customizeRow = (columnName, index) => (
    <div className="labelEditorRow" key={columnName}>
      <label htmlFor={`rename-${columnName}`}>{labelOf(columnName)}</label>
      <div className="labelEditorControls">
        {index !== null && isColorLayout && (
          <ColorScalePicker
            value={variableScales[columnName] || null}
            autoName={autoScaleNameFor(variablesByName.get(columnName))}
            onPick={(name) => setVariableScale(columnName, name)}
          />
        )}
        {index !== null && !isColorLayout && (
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
      {yAxisColumns.includes(columnName) && (
        <label className="labelEditorCheckbox">
          <input
            type="checkbox"
            checked={reversedYAxes.has(columnName)}
            onChange={(event) =>
              setYAxisReversed(columnName, event.target.checked)
            }
            aria-label={`${t("datasetPreviewPlotInvertYAxis")}: ${labelOf(columnName)}`}
          />
          {t("datasetPreviewPlotInvertYAxis")}
        </label>
      )}
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
        className={
          paneCollapsed
            ? "datasetPreviewParamsPane isCollapsed"
            : "datasetPreviewParamsPane"
        }
        id={PARAMS_PANE_ID}
        style={{ width: paneCollapsed ? 0 : paneWidth }}
      >
        {/* First in the pane deliberately: it is the one control that changes
            every panel at once. A filled colour plot has no plot type. */}
        {!isColorLayout && (
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
        )}

        {colorPlotAvailable && (
          <ControlRow caption={t("datasetPreviewPlotLayout")}>
            <DropdownButton
              className="dropdownButtonLeft"
              data-testid="preview-layout-dropdown"
              title={toggleLabel(t(activeLayout.labelKey))}
            >
              {PLOT_LAYOUTS.map(({ value, labelKey }) => (
                <Dropdown.Item
                  key={value}
                  data-testid="preview-layout-option"
                  active={plotLayout === value}
                  onClick={() => setPlotLayout(value)}
                >
                  {t(labelKey)}
                </Dropdown.Item>
              ))}
            </DropdownButton>
          </ControlRow>
        )}

        {isColorLayout ? (
          <>
            <ControlRow
              caption={t("datasetPreviewPlotXAxis")}
              tooltip={labelOf(colorX)}
            >
              {axisDropdown(colorX, setColorX, colorY)}
            </ControlRow>
            <ControlRow
              caption={t("datasetPreviewPlotYAxis")}
              tooltip={labelOf(colorY)}
            >
              {axisDropdown(colorY, setColorY, colorX)}
            </ControlRow>
            <ControlRow
              caption={t("datasetPreviewPlotColorBy")}
              hint={t("datasetPreviewPlotAddRemovePlots")}
              tooltip={panels.map(labelOf).join(", ")}
            >
              <VariablePicker
                choices={colorCandidates.filter(
                  (variable) =>
                    variable.columnName !== colorX &&
                    variable.columnName !== colorY,
                )}
                panels={panels}
                variablesByName={variablesByName}
                togglePanel={togglePanel}
                setPanels={setPanels}
                maxSelected={MAX_COLOR_PANELS}
              />
            </ControlRow>
          </>
        ) : (
          <>
            <ControlRow
              caption={axisCaptionFor(directions.x)}
              tooltip={labelOf(sharedAxis)}
            >
              <DropdownButton
                className="dropdownButtonLeft"
                title={toggleLabel(
                  shortLabelFor(variablesByName.get(sharedAxis)),
                )}
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
                colorAxis
                  ? labelOf(colorAxis)
                  : t("datasetPreviewPlotColorNone")
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
          </>
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
            {isColorLayout
              ? [colorX, colorY]
                  .filter(Boolean)
                  .map((columnName) => customizeRow(columnName, null))
              : sharedAxis && customizeRow(sharedAxis, null)}
            {panels.map((columnName, index) => customizeRow(columnName, index))}
          </div>
        )}
      </div>

      <button
        type="button"
        className="paneCollapseToggle"
        aria-expanded={!paneCollapsed}
        aria-controls={PARAMS_PANE_ID}
        aria-label={t(
          paneCollapsed
            ? "datasetPreviewPlotShowParams"
            : "datasetPreviewPlotHideParams",
        )}
        title={t(
          paneCollapsed
            ? "datasetPreviewPlotShowParams"
            : "datasetPreviewPlotHideParams",
        )}
        onClick={() => setPaneCollapsed(!paneCollapsed)}
      >
        {paneCollapsed ? (
          <ChevronBarRight size={16} aria-hidden="true" />
        ) : (
          <ChevronBarLeft size={16} aria-hidden="true" />
        )}
      </button>
      {!paneCollapsed && (
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
      )}

      <div className="datasetPreviewPlotColumn">
        {/* Above the figure rather than in the parameters pane: this says WHICH
            rows are drawn where every control in the pane says how, and the
            pane is too narrow to read a cast's date in. */}
        {hasProfileHeader && (
          <div className="previewProfileHeader">
            <h5 className="previewProfileTitle" title={inspectRecordID}>
              {t("previewProfileTitle", { record: inspectRecordID })}
            </h5>
            {!isColorLayout && ( // the colour plot draws every profile at once
              <ProfileSlice profiles={profiles} step={step} setStep={setStep} />
            )}
          </div>
        )}

        <div
          className={`datasetPreviewPlotBody ${pinnedLeft ? "isPinnedLeft" : "isPinnedBelow"}`}
        >
          <div className="datasetPreviewPlotArea" ref={plotAreaRef}>
            {split ? (
              <Plot
                data={split.figure.data}
                layout={split.figure.layout}
                onInitialized={readPinnedView}
                onUpdate={readPinnedView}
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
                    "toImage", // replaced below: it would miss the pinned axis and the colour legend
                  ],
                  modeBarButtonsToAdd: [
                    {
                      name: "downloadPlotPng",
                      title: t("datasetPreviewPlotDownloadPng"),
                      icon: Plotly.Icons.camera,
                      click: downloadPng,
                    },
                    {
                      name: "plotInteractionHelp",
                      title: t("datasetPreviewPlotInteractionHelpTitle"),
                      icon: Plotly.Icons.question,
                      click: () => setShowInteractionHelp(true),
                    },
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

          {split && (
            <div
              className="pinnedAxis"
              // Sized before the figure is drawn, so the scroller beside it is
              // measured at its final size.
              style={
                pinnedLeft
                  ? { width: `${pinnedThickness}px` }
                  : { height: `${pinnedThickness}px` }
              }
            >
              {pinnedFigure && (
                <Plot
                  data={pinnedFigure.data}
                  layout={pinnedFigure.layout}
                  useResizeHandler={false}
                  config={PINNED_AXIS_CONFIG}
                />
              )}
            </div>
          )}
        </div>

        {/* Below the scroller, not inside it: a profile wide enough to scroll
            is exactly the plot whose scale would otherwise be off-screen. */}
        <ColorScaleLegend legend={figure && figure.colorLegend} />
      </div>

      <HelpModal
        show={showInteractionHelp}
        onHide={() => setShowInteractionHelp(false)}
        id="plotInteractionHelpModal"
        data-testid="plot-interaction-help-modal"
        icon={<QuestionCircle size={20} />}
        title={t("datasetPreviewPlotInteractionHelpTitle")}
      >
        <ul className="helpModalText plotInteractionHelpList">
          {t("datasetPreviewPlotInteractionHelp")
            .split("\n")
            .map((line) => (
              <li key={line}>{line}</li>
            ))}
        </ul>
      </HelpModal>
    </div>
  );
}
