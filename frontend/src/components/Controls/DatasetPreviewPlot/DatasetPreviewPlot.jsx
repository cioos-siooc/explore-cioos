import * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowCounterclockwise,
  ArrowDownUp,
  ChevronBarLeft,
  ChevronBarRight,
  ChevronDown,
  ChevronUp,
  Gear,
  QuestionCircle,
} from "react-bootstrap-icons";
import HelpModal from "../../ui/HelpModal.jsx";
import Modal from "../../ui/Modal.jsx";
import PaneDivider from "../../ui/PaneDivider.jsx";
import SegmentedToggle from "../../ui/SegmentedToggle.jsx";
import useElementSize from "../../ui/useElementSize.js";
import useMediaQuery, {
  PREVIEW_COMPACT_QUERY,
  REDUCED_MOTION_QUERY,
} from "../../../state/ui/useMediaQuery.js";
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
  buildGridFigure,
  buildOverlayFigure,
  gridBoxFor,
  plotBoxFor,
} from "../DatasetPreview/previewFacetFigure.js";
import {
  pinnedAxisSizeFor,
  MAX_STACKED_AXES,
} from "../DatasetPreview/previewFacetSizing.js";
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
import {
  defaultColorFor,
  distinctColorsFor,
} from "../DatasetPreview/previewColors.js";
import { autoScaleNameFor } from "../DatasetPreview/previewColorScales.js";
import { POSITION_INDEX_COLUMN } from "../DatasetPreview/previewTrackIndex.js";
import {
  MAX_COLOR_PANELS,
  PLOT_LAYOUTS,
  PLOT_MODES,
} from "../DatasetPreview/usePreviewPlotParams.js";
import { usePreviewPlot } from "../DatasetPreview/PreviewPlotProvider.jsx";

const PARAMS_PANE_ID = "datasetPreviewParamsPane";
const SETTINGS_TITLE_ID = "datasetPreviewSettingsTitle";
// Past the pane's 200ms width transition (styles.css).
const SLIDE_BACKSTOP_MS = 500;
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
    sharedAxes,
    setSharedAxes,
    panels,
    setPanels,
    flipPanelAxis,
    variableColors,
    setVariableColor,
    colorCandidates,
    colorAxes,
    setColorAxes,
    plotLayout,
    setPlotLayout,
    colorPlotAvailable,
    stacked,
    setStacked,
    colorXs,
    setColorXs,
    colorYs,
    setColorYs,
    variableScales,
    setVariableScale,
    colorColumns,
    sharedColorScale,
    setSharedColorScale,
    scalesInUse,
    yAxisColumns,
    reversedYAxes,
    setYAxisReversed,
    plotType,
    setPlotType,
    plotCustomized,
    resetPlot,
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
    settingsOpen,
    setSettingsOpen,
  } = usePreviewPlot();

  // Purely local: which panel is folded open is not worth sharing in a link.
  const [showLabels, setShowLabels] = useState(false);
  // Only for the cursor and the text-selection lock while a drag is live.
  const [resizing, setResizing] = useState(false);
  // Too narrow for two panes side by side: the settings fold above the plot.
  const settingsInDialog = useMediaQuery(PREVIEW_COMPACT_QUERY);

  // The plot pane's own box. Its width is what the figure is drawn to; its
  // height enters only through plotBoxFor, which can lower the ceiling that
  // availableHeight sets but never raise it.
  const [plotAreaRef, liveAreaSize] = useElementSize();
  // While the pane slides the plot keeps the size it had, and re-lays out once
  // when the slide ends, rather than re-plotting every frame of it.
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const [slideFrom, setSlideFrom] = useState(null);
  const plotAreaSize = slideFrom ?? liveAreaSize;
  const togglePane = () => {
    if (!reducedMotion) setSlideFrom(liveAreaSize);
    setPaneCollapsed(!paneCollapsed);
  };
  // A backstop for a slide that never reports its end (a hidden tab).
  useEffect(() => {
    if (!slideFrom) return undefined;
    const timer = setTimeout(() => setSlideFrom(null), SLIDE_BACKSTOP_MS);
    return () => clearTimeout(timer);
  }, [slideFrom]);
  const panelChoices = panelCandidatesFor(
    variables,
    sharedAxis,
    inspectDataset,
  ).filter((variable) => !sharedAxes.includes(variable.columnName));
  const sharedCandidates = sharedCandidatesFor(variables, inspectDataset);
  const directions = axisDirectionsFor(plan.orientation);
  const sharedIsX = directions.x === "horizontal";
  const hasProfileHeader = PROFILE_RECORD_TYPES.includes(
    inspectDataset?.cdm_data_type,
  );
  const isColorLayout = plotLayout === "color";
  const axisCaptionFor = (direction) =>
    direction === "horizontal"
      ? t("datasetPreviewPlotXAxis")
      : t("datasetPreviewPlotYAxis");

  // Several variables on both axes, or several colour columns: every
  // combination is a panel of its own, laid out as a grid. A colour plot
  // grids only once it has several X; more Y just stack more rows.
  const panelXAxes = plan.orientation === COLUMNS ? panels : sharedAxes;
  const panelYAxes = plan.orientation === COLUMNS ? sharedAxes : panels;
  const isGrid = isColorLayout
    ? colorXs.length > 1
    : sharedAxes.length > 1 || colorAxes.length > 1;
  const gridColumns = isColorLayout
    ? colorXs.length
    : panelXAxes.length * Math.max(colorAxes.length, 1);
  const gridRows = isColorLayout
    ? panels.length * colorYs.length
    : panelYAxes.length;

  // The figure's box and the title that shapes it. One call because the three
  // have to be derived in that order — see plotBoxFor.
  const { title, width, height } = useMemo(() => {
    const shared = {
      plan,
      variablesByName,
      data: plotData,
      availableHeight,
      measured: plotAreaSize,
      withTitle: !hasProfileHeader,
    };
    if (isGrid) {
      return gridBoxFor({
        ...shared,
        columns: gridColumns,
        rows: gridRows,
        header: !isColorLayout && colorAxes.length > 1,
        colorbars: isColorLayout,
      });
    }
    return plotBoxFor({
      ...shared,
      panelCount: isColorLayout ? gridRows : panels.length,
      orientation: isColorLayout ? ROWS : plan.orientation,
    });
  }, [
    plan,
    variablesByName,
    plotData,
    panels.length,
    availableHeight,
    plotAreaSize,
    hasProfileHeader,
    isColorLayout,
    isGrid,
    gridColumns,
    gridRows,
    colorAxes.length,
  ]);

  // The ticks and the position labels belong to the index and to nothing else:
  // switch the axis back to longitude and they would label the wrong numbers.
  const onPositionAxis = Boolean(
    trackIndex &&
    (isColorLayout ? colorXs[0] : sharedAxis) === POSITION_INDEX_COLUMN,
  );
  const position = useMemo(
    () =>
      trackIndex && {
        column: POSITION_INDEX_COLUMN,
        ticks: trackIndex.ticks,
        labels: trackIndex.labels,
      },
    [trackIndex],
  );

  // react-plotly.js re-plots whenever `data`/`layout` identity changes, e.g. on
  // every keystroke in the rename field.
  const figure = useMemo(() => {
    if (!panels.length || !plotData) return null;
    const revision = `${inspectRecordID}|${uirevision}`;
    if (isColorLayout) {
      return colorXs.length && colorYs.length
        ? buildColorFigure({
            variablesByName,
            panels,
            xAxes: colorXs,
            yAxes: colorYs,
            data: plotData,
            labels: customLabels,
            scales: scalesInUse,
            title,
            sharedTicks: onPositionAxis ? trackIndex.ticks : null,
            sharedText: onPositionAxis ? trackIndex.labels : null,
            position,
            size: { width, height },
            uirevision: revision,
            reversedYAxes,
          })
        : null;
    }
    if (stacked) {
      return buildOverlayFigure({
        plan,
        variablesByName,
        panels,
        sharedAxis,
        data: plotData,
        colors: variableColors,
        labels: customLabels,
        title,
        mode: plotType,
        sharedTicks: onPositionAxis ? trackIndex.ticks : null,
        size: { width, height },
        uirevision: revision,
        reversedYAxes,
      });
    }
    if (isGrid) {
      return panelXAxes.length && panelYAxes.length
        ? buildGridFigure({
            variablesByName,
            xAxes: panelXAxes,
            yAxes: panelYAxes,
            panelAxis: plan.orientation === COLUMNS ? "x" : "y",
            colorAxes,
            data: plotData,
            colors: variableColors,
            labels: customLabels,
            title,
            mode: plotType,
            scales: scalesInUse,
            position,
            size: { width, height },
            uirevision: revision,
            reversedYAxes,
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
      colorAxis: colorAxes[0] ?? null,
      colorScale: scalesInUse[colorAxes[0]] ?? null,
      sharedTicks: onPositionAxis ? trackIndex.ticks : null,
      sharedText: onPositionAxis ? trackIndex.labels : null,
      size: { width, height },
      uirevision: revision,
      reversedYAxes,
    });
  }, [
    isColorLayout,
    stacked,
    isGrid,
    colorXs,
    colorYs,
    panelXAxes,
    panelYAxes,
    scalesInUse,
    plan,
    variablesByName,
    panels,
    sharedAxis,
    plotData,
    variableColors,
    customLabels,
    title,
    plotType,
    colorAxes,
    onPositionAxis,
    position,
    trackIndex,
    width,
    height,
    inspectRecordID,
    uirevision,
    reversedYAxes,
  ]);
  const colorLegends = figure
    ? figure.colorLegends || [figure.colorLegend].filter(Boolean)
    : [];

  // The shared axis leaves the scroller for a strip beside it, so its scale and
  // title stay in view while the panels scroll — see previewPinnedAxis.js.
  const pinnedOrientation = isColorLayout ? ROWS : plan.orientation;
  // A grid has no one shared axis to pin: each column and row keeps its own.
  const split = useMemo(
    () =>
      figure &&
      (figure.pinnable === false
        ? { figure, axis: null }
        : splitPinnedAxis(figure, pinnedOrientation)),
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
      split && split.axis && pinnedView
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
      colorLegends: figure.colorLegends,
    });
    Plotly.downloadImage(
      { data: exported.data, layout: exported.layout },
      { format: "png", width: exported.width, height: exported.height },
    );
  };
  const pinnedThickness = pinnedAxisSizeFor(pinnedOrientation);
  const pinnedLeft = pinnedOrientation === COLUMNS;

  const labelOf = (columnName) => labelFor(variablesByName.get(columnName));

  // One Y axis on screen: its invert button rides on the row that picks it.
  // Several (one per panel) and each gets its own checkbox under Labels &
  // colours instead, where every panel already has a row.
  const singleYAxis = yAxisColumns.length === 1 ? yAxisColumns[0] : null;
  const invertYButton = singleYAxis && (
    <button
      type="button"
      className="controlAction"
      aria-pressed={reversedYAxes.has(singleYAxis)}
      aria-label={`${t("datasetPreviewPlotInvertYAxis")}: ${labelOf(singleYAxis)}`}
      title={t("datasetPreviewPlotInvertYAxis")}
      onClick={() =>
        setYAxisReversed(singleYAxis, !reversedYAxes.has(singleYAxis))
      }
    >
      <ArrowDownUp size={12} aria-hidden="true" />
    </button>
  );

  // The colour plot's axes: several make a grid. `excluded` keeps X and Y
  // apart.
  const axisPicker = (label, selected, onSelect, excluded, isMulti) => (
    <VariablePicker
      label={label}
      isMulti={isMulti}
      choices={sharedCandidates.filter(
        (variable) => !excluded.includes(variable.columnName),
      )}
      value={selected}
      variablesByName={variablesByName}
      required
      onChange={(picked) => picked.length && onSelect(picked)}
    />
  );

  const scalePicker = (columnName) => (
    <ColorScalePicker
      value={variableScales[columnName] || null}
      autoName={autoScaleNameFor(variablesByName.get(columnName))}
      onPick={(name) => setVariableScale(columnName, name)}
    />
  );
  const sharingScale = sharedColorScale && colorColumns.length > 1;
  // The colour plot keeps each panel's own picker under Labels & colours, so
  // here it only needs the row to share one.
  const colorScaleRow = (isColorLayout
    ? colorColumns.length > 1
    : colorColumns.length > 0) && (
    <ControlRow caption={t("datasetPreviewPlotColorScale")}>
      <span className="colorScaleStack">
        {colorColumns.length > 1 && (
          <SegmentedToggle
            label={t("datasetPreviewPlotScaleSharing")}
            data-testid="preview-scale-sharing-toggle"
            options={[
              {
                value: "separate",
                label: t("datasetPreviewPlotScalesSeparate"),
              },
              { value: "shared", label: t("datasetPreviewPlotScalesShared") },
            ]}
            value={sharingScale ? "shared" : "separate"}
            onChange={(value) => setSharedColorScale(value === "shared")}
          />
        )}
        {sharingScale || colorColumns.length === 1
          ? scalePicker(colorColumns[0])
          : !isColorLayout &&
            colorColumns.map((columnName) => (
              <span className="colorScaleItem" key={columnName}>
                <span className="colorScaleItemName">
                  {labelOf(columnName)}
                </span>
                {scalePicker(columnName)}
              </span>
            ))}
      </span>
    </ControlRow>
  );

  // On one plot a default colour another curve already has is swapped, so the
  // picker shows the colour actually drawn.
  const stackedDefaults = stacked
    ? distinctColorsFor(panels, variablesByName, {})
    : null;

  // The shared axis draws no trace, so it gets a name but no colour.
  const customizeRow = (columnName, index) => (
    <div className="labelEditorRow" key={columnName}>
      <label htmlFor={`rename-${columnName}`}>{labelOf(columnName)}</label>
      <div className="labelEditorControls">
        {index !== null && isColorLayout && !sharingScale && (
          <ColorScalePicker
            value={variableScales[columnName] || null}
            autoName={autoScaleNameFor(variablesByName.get(columnName))}
            onPick={(name) => setVariableScale(columnName, name)}
          />
        )}
        {index !== null && !isColorLayout && (
          <VariableColorPicker
            color={variableColors[columnName] || null}
            defaultColor={
              stackedDefaults
                ? stackedDefaults[columnName]
                : defaultColorFor(variablesByName.get(columnName), index)
            }
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
      {!singleYAxis && yAxisColumns.includes(columnName) && (
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

  // Either axis can hold several variables, one at a time: while the panels'
  // axis holds exactly one, a second one on the shared axis flips the plot.
  const canFlip = panels.length === 1;
  const sharedAxisRow = (
    <ControlRow
      caption={axisCaptionFor(directions.x)}
      action={!sharedIsX && invertYButton}
    >
      <VariablePicker
        label={axisCaptionFor(directions.x)}
        choices={
          canFlip
            ? sharedCandidates.filter(
                (variable) => variable.columnName !== panels[0],
              )
            : sharedCandidates
        }
        value={sharedAxes}
        variablesByName={variablesByName}
        isMulti={panels.length <= 1 && colorAxes.length <= 1}
        required
        onChange={(picked) => {
          if (picked.length === 1) setSharedAxis(picked[0]);
          // One panel and one shared variable: the second shared one moves
          // the panels across rather than making a 1 x n grid.
          else if (canFlip && sharedAxes.length === 1) {
            flipPanelAxis(panels[0], picked);
          } else if (picked.length > 1) setSharedAxes(picked);
        }}
      />
    </ControlRow>
  );
  const panelsRow = (
    <ControlRow
      caption={axisCaptionFor(directions.y)}
      action={sharedIsX && invertYButton}
    >
      <VariablePicker
        label={axisCaptionFor(directions.y)}
        choices={panelChoices}
        value={panels}
        variablesByName={variablesByName}
        onChange={setPanels}
        isMulti={sharedAxes.length <= 1 && colorAxes.length <= 1}
        maxSelected={stacked ? MAX_STACKED_AXES : undefined}
      />
    </ControlRow>
  );

  const hasCustomLabels = Object.values(customLabels).some(Boolean);
  const resetAll = () => {
    resetPlot();
    setCustomLabels({});
  };

  const bounds = { paneWidth, plotWidth: plotAreaSize.width };

  const paneToggleKey = paneCollapsed
    ? "datasetPreviewPlotShowParams"
    : "datasetPreviewPlotHideParams";

  // In the profile header when there is one, so it costs the plot no row.
  const settingsButton = settingsInDialog && (
    <button
      type="button"
      className="paneSettingsButton"
      aria-haspopup="dialog"
      aria-expanded={settingsOpen}
      aria-label={t("datasetPreviewPlotSettings")}
      title={t("datasetPreviewPlotSettings")}
      onClick={() => setSettingsOpen(true)}
    >
      <Gear size={16} aria-hidden="true" />
    </button>
  );

  const paneControls = (
    <>
      {/* A filled colour plot has no plot type. */}
      {!isColorLayout && (
        <ControlRow caption={t("plotType")}>
          <SegmentedToggle
            label={t("plotType")}
            data-testid="preview-mode-toggle"
            options={PLOT_MODES.map(({ value, labelKey }) => ({
              value,
              label: t(labelKey),
            }))}
            value={plotType}
            onChange={setPlotType}
          />
        </ControlRow>
      )}

      {/* Before the axes: it decides what every one of them means. */}
      {colorPlotAvailable && (
        <ControlRow caption={t("datasetPreviewPlotLayout")}>
          <SegmentedToggle
            label={t("datasetPreviewPlotLayout")}
            data-testid="preview-layout-toggle"
            options={PLOT_LAYOUTS.map(({ value, labelKey }) => ({
              value,
              label: t(labelKey),
            }))}
            value={plotLayout}
            onChange={setPlotLayout}
          />
        </ControlRow>
      )}

      {!isColorLayout && (
        <ControlRow caption={t("datasetPreviewPlotCurves")}>
          <SegmentedToggle
            label={t("datasetPreviewPlotCurves")}
            data-testid="preview-stack-toggle"
            options={[
              { value: "panels", label: t("datasetPreviewPlotCurvesPanels") },
              { value: "stacked", label: t("datasetPreviewPlotCurvesStacked") },
            ]}
            value={stacked ? "stacked" : "panels"}
            onChange={(value) => setStacked(value === "stacked")}
          />
        </ControlRow>
      )}

      {isColorLayout ? (
        <>
          <ControlRow caption={t("datasetPreviewPlotXAxis")}>
            {axisPicker(
              t("datasetPreviewPlotXAxis"),
              colorXs,
              setColorXs,
              colorYs,
              colorYs.length <= 1 && panels.length <= 1,
            )}
          </ControlRow>
          <ControlRow
            caption={t("datasetPreviewPlotYAxis")}
            action={invertYButton}
          >
            {axisPicker(
              t("datasetPreviewPlotYAxis"),
              colorYs,
              setColorYs,
              colorXs,
              colorXs.length <= 1 && panels.length <= 1,
            )}
          </ControlRow>
          <ControlRow caption={t("datasetPreviewPlotColorBy")} startsGroup>
            <VariablePicker
              label={t("datasetPreviewPlotColorBy")}
              choices={colorCandidates.filter(
                (variable) =>
                  !colorXs.includes(variable.columnName) &&
                  !colorYs.includes(variable.columnName),
              )}
              value={panels}
              variablesByName={variablesByName}
              onChange={setPanels}
              isMulti={colorXs.length <= 1 && colorYs.length <= 1}
              maxSelected={MAX_COLOR_PANELS}
            />
          </ControlRow>
          {colorScaleRow}
        </>
      ) : (
        <>
          {sharedIsX ? (
            <>
              {sharedAxisRow}
              {panelsRow}
            </>
          ) : (
            <>
              {panelsRow}
              {sharedAxisRow}
            </>
          )}

          {/* On one plot, colour already says which axis a curve reads on. */}
          {!stacked && (
            <ControlRow caption={t("datasetPreviewPlotColorBy")} startsGroup>
              <VariablePicker
                label={t("datasetPreviewPlotColorBy")}
                choices={colorCandidates}
                value={colorAxes}
                variablesByName={variablesByName}
                placeholder={t("datasetPreviewPlotColorNone")}
                onChange={setColorAxes}
                isMulti={panels.length <= 1 && sharedAxes.length <= 1}
                maxSelected={MAX_COLOR_PANELS}
              />
            </ControlRow>
          )}

          {colorScaleRow}
        </>
      )}

      <button
        type="button"
        className="labelEditorToggle"
        aria-expanded={showLabels}
        onClick={() => setShowLabels(!showLabels)}
      >
        {t("datasetPreviewPlotCustomizePlot")}
        {showLabels ? (
          <ChevronUp size={12} aria-hidden="true" />
        ) : (
          <ChevronDown size={12} aria-hidden="true" />
        )}
      </button>
      {showLabels && (
        <div className="labelEditor">
          {isColorLayout
            ? [...colorXs, ...colorYs].map((columnName) =>
                customizeRow(columnName, null),
              )
            : sharedAxes.map((columnName) => customizeRow(columnName, null))}
          {panels.map((columnName, index) => customizeRow(columnName, index))}
        </div>
      )}

      <button
        type="button"
        className="resetPlotButton"
        disabled={!plotCustomized && !hasCustomLabels}
        onClick={resetAll}
      >
        <ArrowCounterclockwise size={12} aria-hidden="true" />
        {t("datasetPreviewPlotReset")}
      </button>
    </>
  );

  return (
    <div
      className={[
        "datasetPreviewPlotPanes",
        resizing && "isResizing",
        slideFrom && "isSliding",
        !settingsInDialog && paneCollapsed && "isPaneHidden",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {settingsInDialog ? (
        <>
          {!hasProfileHeader && settingsButton}
          {/* Over the plot rather than beside or above it: there is not the
              width to share, nor the height to fold into. */}
          <Modal
            show={settingsOpen}
            onHide={() => setSettingsOpen(false)}
            centered
            scrollable
            className="previewSettingsModal"
            aria-labelledby={SETTINGS_TITLE_ID}
          >
            <Modal.Header closeButton>
              <Modal.Title id={SETTINGS_TITLE_ID}>
                {t("datasetPreviewPlotSettings")}
              </Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <div className="datasetPreviewParamsPane" id={PARAMS_PANE_ID}>
                {paneControls}
              </div>
            </Modal.Body>
          </Modal>
        </>
      ) : (
        <>
          <div
            className={
              paneCollapsed
                ? "datasetPreviewParamsPane isCollapsed"
                : "datasetPreviewParamsPane"
            }
            id={PARAMS_PANE_ID}
            style={{ width: paneCollapsed ? 0 : paneWidth }}
            onTransitionEnd={(event) => {
              if (
                event.target === event.currentTarget &&
                event.propertyName === "width"
              )
                setSlideFrom(null);
            }}
          >
            {paneControls}
          </div>
          <button
            type="button"
            className="paneCollapseToggle"
            aria-expanded={!paneCollapsed}
            aria-controls={PARAMS_PANE_ID}
            aria-label={t(paneToggleKey)}
            title={t(paneToggleKey)}
            onClick={togglePane}
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
        </>
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
            {settingsButton}
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

          {split && split.axis && (
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
        {colorLegends.map((legend) => (
          <ColorScaleLegend key={legend.label} legend={legend} />
        ))}
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
