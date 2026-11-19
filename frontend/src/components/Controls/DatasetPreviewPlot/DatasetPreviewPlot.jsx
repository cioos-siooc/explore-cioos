import * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowCounterclockwise,
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
  MOBILE_QUERY,
  PREVIEW_COMPACT_QUERY,
  REDUCED_MOTION_QUERY,
  TOUCH_QUERY,
} from "../../../state/ui/useMediaQuery.js";
import ControlRow from "./ControlRow.jsx";
import VariablePicker from "./VariablePicker.jsx";
import VariableColorPicker from "./VariableColorPicker.jsx";
import ColorScalePicker from "./ColorScalePicker.jsx";
import ColorScaleLegend from "./ColorScaleLegend.jsx";
import ProfileSlice from "./ProfileSlice.jsx";
import PreviewWindowPager from "../DatasetPreview/PreviewWindowPager.jsx";
import "./styles.css";

import Plotly from "./previewPlotly.js";
import createPlotlyComponent from "react-plotly.js/factory";
import isEqual from "lodash-es/isEqual";

import { labelFor, shortLabelFor } from "../DatasetPreview/previewVariables.js";
import {
  LABEL_FONT_PX,
  MOBILE_LABEL_FONT_PX,
  MOBILE_LABEL_LINES,
} from "../DatasetPreview/previewLabelText.js";
import {
  axisDirectionsFor,
  panelCandidatesFor,
  sharedCandidatesFor,
  COLUMNS,
} from "../DatasetPreview/previewFacetPlan.js";
import {
  buildFigure,
  buildGridFigure,
  buildOverlayFigure,
  gridBoxFor,
  plotBoxFor,
  idLabelFor,
  recordTitleFor,
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
  ACROSS,
  DOWN,
} from "../DatasetPreview/usePreviewPlotParams.js";
import { usePreviewPlot } from "../DatasetPreview/PreviewPlotProvider.jsx";
import { ROW_LIMITS } from "../../../state/selection/previewParams.js";

const PARAMS_PANE_ID = "datasetPreviewParamsPane";
const SETTINGS_TITLE_ID = "datasetPreviewSettingsTitle";
// Past the pane's 200ms width transition (styles.css).
const SLIDE_BACKSTOP_MS = 500;
// Records holding many casts: named in a header row beside the cast slider
// instead of in the figure's own title.
const PROFILE_RECORD_TYPES = ["TimeSeriesProfile", "TrajectoryProfile"];

const Plot = createPlotlyComponent(Plotly);

const PINNED_AXIS_CONFIG = { staticPlot: true, displayModeBar: false };

// Only on the plot itself: the modebar's buttons still need their click.
const suppressEmulatedMouse = (event) => {
  if (event.cancelable && event.target.closest(".nsewdrag")) {
    event.preventDefault();
  }
};

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
    stacked,
    setStacked,
    facetCount,
    facetDirection,
    setFacetDirection,
    variableScales,
    setVariableScale,
    colorColumns,
    sharedColorScale,
    setSharedColorScale,
    scalesInUse,
    yAxisColumns,
    reversedYAxes,
    setYAxisReversed,
    plotModes,
    plotType,
    setPlotType,
    plotCustomized,
    resetPlot,
    profiles,
    step,
    setStep,
    previewWindow,
    rowLimit,
    setRowLimit,
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
  // A finger's drag pans the data, so the figure has to fit the screen: there
  // is no drag left over to scroll it with.
  const touch = useMediaQuery(TOUCH_QUERY);
  // A phone spends its height on the data: smaller labels, panel titles held to
  // two lines, and no header row of the plot's own.
  const mobile = useMediaQuery(MOBILE_QUERY);
  const labelFont = mobile ? MOBILE_LABEL_FONT_PX : LABEL_FONT_PX;
  const labelLines = mobile ? MOBILE_LABEL_LINES : undefined;

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
  // Compact, the figure is often wider than its scroller, and a title centred
  // over it would be cut off; the header row the settings gear needs holds it.
  const titleInHeader = hasProfileHeader || settingsInDialog;
  const showSlice = hasProfileHeader;
  const axisCaptionFor = (direction) =>
    direction === "horizontal"
      ? t("datasetPreviewPlotXAxis")
      : t("datasetPreviewPlotYAxis");

  // Several variables on both axes, or several colour columns: every
  // combination is a panel of its own, laid out as a grid.
  const panelXAxes = plan.orientation === COLUMNS ? panels : sharedAxes;
  const panelYAxes = plan.orientation === COLUMNS ? sharedAxes : panels;
  const isGrid = sharedAxes.length > 1 || colorAxes.length > 1;
  const colorRepeats = Math.max(colorAxes.length, 1);
  const gridColumns = panelXAxes.length * (plan.colorRows ? 1 : colorRepeats);
  const gridRows = panelYAxes.length * (plan.colorRows ? colorRepeats : 1);

  // The figure's box and the title that shapes it. One call because the three
  // have to be derived in that order — see plotBoxFor.
  const { title, width, height } = useMemo(() => {
    const shared = {
      plan,
      variablesByName,
      data: plotData,
      availableHeight,
      measured: plotAreaSize,
      withTitle: !titleInHeader,
      minPanel: touch ? 0 : undefined,
      labelFont,
    };
    if (isGrid) {
      return gridBoxFor({
        ...shared,
        columns: gridColumns,
        rows: gridRows,
        header: !plan.colorRows && colorAxes.length > 1,
        colorbars: Boolean(plan.colorRows),
      });
    }
    return plotBoxFor({
      ...shared,
      panelCount: panels.length,
    });
  }, [
    plan,
    variablesByName,
    plotData,
    panels.length,
    availableHeight,
    plotAreaSize,
    titleInHeader,
    touch,
    labelFont,
    isGrid,
    gridColumns,
    gridRows,
    colorAxes.length,
  ]);

  // The ticks and the position labels belong to the index and to nothing else:
  // switch the axis back to longitude and they would label the wrong numbers.
  const onPositionAxis = Boolean(
    trackIndex && sharedAxis === POSITION_INDEX_COLUMN,
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
        labelFont,
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
            colorRows: plan.colorRows,
            data: plotData,
            colors: variableColors,
            labels: customLabels,
            title,
            mode: plotType,
            scales: scalesInUse,
            position,
            size: { width, height },
            labelFont,
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
      labelFont,
      pinned: !touch,
      labelLines,
      uirevision: revision,
      reversedYAxes,
    });
  }, [
    labelFont,
    labelLines,
    touch,
    stacked,
    isGrid,
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
  const pinnedOrientation = plan.orientation;
  // A grid has no one shared axis to pin: each column and row keeps its own.
  // Nor does a touch screen's (`pinned` false): it fits its box and never
  // scrolls, so it keeps its axis and Plotly's automargin sizes the edge to it.
  const split = useMemo(
    () =>
      figure &&
      (figure.pinnable === false
        ? { figure, axis: null }
        : splitPinnedAxis(figure, pinnedOrientation)),
    [figure, pinnedOrientation],
  );
  // Zooming is the toolbar's; picking its zoom tool turns the drag into a box.
  const mainLayout = useMemo(
    () =>
      split && touch
        ? { ...split.figure.layout, dragmode: "pan" }
        : split?.figure.layout,
    [split, touch],
  );
  let headerTitle = "";
  if (hasProfileHeader && inspectRecordID) {
    // The record may be the station or the cast, so its role comes from the
    // id column that holds it.
    const recordIdVariable = plan.titleColumns
      .map((columnName) => variablesByName.get(columnName))
      .find(
        (variable) =>
          variable &&
          plotData?.some(
            (row) =>
              String(row[variable.columnName]) === String(inspectRecordID),
          ),
      );
    headerTitle = recordIdVariable
      ? `${idLabelFor(recordIdVariable)}: ${inspectRecordID}`
      : t("previewProfileTitle", { record: inspectRecordID });
  } else if (titleInHeader) {
    headerTitle = recordTitleFor({ plan, variablesByName, data: plotData });
  }
  const [pinnedView, setPinnedView] = useState(null);
  const [showInteractionHelp, setShowInteractionHelp] = useState(false);
  // Fired after every draw and every zoom, so an unchanged view must not
  // re-render.
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
        ? pinnedAxisFigureFor(
            split.axis,
            pinnedView,
            pinnedOrientation,
            labelFont,
          )
        : null,
    [split, pinnedView, pinnedOrientation, labelFont],
  );
  const downloadPng = useCallback(
    (graphDiv) => {
      const exported = exportFigureFor({
        data: graphDiv.data,
        layout: graphDiv.layout,
        pinnedAxis: split.axis,
        orientation: pinnedOrientation,
        colorLegend: figure.colorLegend,
        colorLegends: figure.colorLegends,
        labelFont,
      });
      Plotly.downloadImage(
        { data: exported.data, layout: exported.layout },
        { format: "png", width: exported.width, height: exported.height },
      );
    },
    [split, figure, pinnedOrientation, labelFont],
  );
  // Memoised: react-plotly.js re-plots whenever `config` changes identity, which
  // an inline object did on every render of this component.
  const { language } = i18n;
  const plotConfig = useMemo(
    () => ({
      displaylogo: false,
      // Always shown: export and the interaction help live in it, and a toolbar
      // that appears only on hover hides both from anyone who has not found it.
      displayModeBar: true,
      // Plotly 4 defaults this on; it posts the chart to cloud.plotly.com.
      showSendToCloud: false,
      modeBarButtonsToRemove: [
        "select2d",
        "lasso2d",
        "resetScale2d",
        // The way back from the zoom tool to a finger's pan.
        ...(touch ? [] : ["pan2d"]),
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
      // Off: `responsive` would fight the sizes set on the Plot; useElementSize
      // drives resizing instead.
      responsive: false,
      scrollZoom: true,
      locale: language === "fr" ? "fr" : "en",
    }),
    [t, language, downloadPng, setShowInteractionHelp, touch],
  );
  // What a screen reader hears in place of the figure, and where the values are.
  const plotSummary = t("datasetPreviewPlotSummary", {
    variables: panels
      .map((columnName) => shortLabelFor(variablesByName.get(columnName)))
      .join(", "),
    axis: shortLabelFor(variablesByName.get(sharedAxis)),
    count: plotData?.length ?? 0,
  });
  const pinnedThickness = pinnedAxisSizeFor(pinnedOrientation, labelFont);
  const pinnedLeft = pinnedOrientation === COLUMNS;

  const labelOf = (columnName) => labelFor(variablesByName.get(columnName));

  // One Y axis on screen: its invert button rides on the row that picks it.
  // Several (one per panel) and each gets its own checkbox under Labels &
  // colours instead, where every panel already has a row.
  const singleYAxis = yAxisColumns.length === 1 ? yAxisColumns[0] : null;
  const reverseCheckbox = (columnName) => (
    <label className="paneCheckbox">
      <input
        type="checkbox"
        checked={reversedYAxes.has(columnName)}
        onChange={(event) => setYAxisReversed(columnName, event.target.checked)}
        aria-label={`${t("datasetPreviewPlotReverseAxis")}: ${labelOf(columnName)}`}
      />
      {t("datasetPreviewPlotReverseAxis")}
    </label>
  );
  const reverseAxisCheckbox = singleYAxis && reverseCheckbox(singleYAxis);

  const scalePicker = (columnName) => (
    <ColorScalePicker
      value={variableScales[columnName] || null}
      autoName={autoScaleNameFor(variablesByName.get(columnName))}
      onPick={(name) => setVariableScale(columnName, name)}
    />
  );
  const sharingScale = sharedColorScale && colorColumns.length > 1;
  const colorScaleRow = colorColumns.length > 0 && (
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
          : colorColumns.map((columnName) => (
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
        {index !== null && (
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
      {!singleYAxis &&
        yAxisColumns.includes(columnName) &&
        reverseCheckbox(columnName)}
    </div>
  );

  // Either axis can hold several variables, one at a time: while the panels'
  // axis holds exactly one, a second one on the shared axis flips the plot.
  const canFlip = panels.length === 1;
  const sharedAxisRow = (
    <ControlRow
      caption={axisCaptionFor(directions.x)}
      action={!sharedIsX && reverseAxisCheckbox}
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
      action={sharedIsX && reverseAxisCheckbox}
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

  const paneControls = (
    <>
      <ControlRow caption={t("plotType")}>
        <SegmentedToggle
          label={t("plotType")}
          data-testid="preview-mode-toggle"
          options={plotModes.map(({ value, labelKey }) => ({
            value,
            label: t(labelKey),
          }))}
          value={plotType}
          onChange={setPlotType}
        />
      </ControlRow>

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

      {facetCount > 1 && (
        <ControlRow caption={t("datasetPreviewPlotFacets")}>
          <SegmentedToggle
            label={t("datasetPreviewPlotFacets")}
            data-testid="preview-facet-toggle"
            options={[
              { value: ACROSS, label: t("datasetPreviewPlotFacetsAcross") },
              { value: DOWN, label: t("datasetPreviewPlotFacetsDown") },
            ]}
            value={facetDirection}
            onChange={setFacetDirection}
          />
        </ControlRow>
      )}

      {previewWindow.offersRows && (
        <ControlRow caption={t("previewWindowRows")} startsGroup>
          <SegmentedToggle
            label={t("previewWindowRows")}
            data-testid="preview-row-limit"
            options={ROW_LIMITS.map((limit) => ({
              value: String(limit),
              label: limit.toLocaleString(i18n.language),
            }))}
            value={String(rowLimit)}
            onChange={(value) => setRowLimit(Number(value))}
          />
        </ControlRow>
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
          <ControlRow caption={t("datasetPreviewPlotCurves")}>
            <SegmentedToggle
              label={t("datasetPreviewPlotCurves")}
              data-testid="preview-stack-toggle"
              options={[
                {
                  value: "panels",
                  label: t("datasetPreviewPlotCurvesPanels"),
                },
                {
                  value: "stacked",
                  label: t("datasetPreviewPlotCurvesStacked"),
                },
              ]}
              value={stacked ? "stacked" : "panels"}
              onChange={(value) => setStacked(value === "stacked")}
            />
          </ControlRow>
          {sharedAxes.map((columnName) => customizeRow(columnName, null))}
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
        // The settings in a dialog leave the corner to their gear, as a
        // collapsed pane leaves it to its toggle.
        (settingsInDialog || paneCollapsed) && "isPaneHidden",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {settingsInDialog ? (
        <>
          <button
            type="button"
            className="paneCollapseToggle"
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
            aria-label={t("datasetPreviewPlotSettings")}
            title={t("datasetPreviewPlotSettings")}
            onClick={() => setSettingsOpen(true)}
          >
            <Gear size={16} aria-hidden="true" />
          </button>
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
            style={
              paneCollapsed
                ? undefined
                : { left: `calc(min(${paneWidth}px, 60%) - 24px)` }
            }
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
        {(showSlice || (titleInHeader && headerTitle && !mobile)) && (
          <div
            className={
              showSlice
                ? "previewProfileHeader"
                : "previewProfileHeader isSingleRow"
            }
          >
            {titleInHeader && headerTitle && !mobile && (
              <h5 className="previewProfileTitle" title={headerTitle}>
                {headerTitle}
              </h5>
            )}
            {showSlice && (
              <ProfileSlice profiles={profiles} step={step} setStep={setStep} />
            )}
          </div>
        )}

        <div
          className={`datasetPreviewPlotBody ${pinnedLeft ? "isPinnedLeft" : "isPinnedBelow"}`}
        >
          {/* Over the figure's top-left corner, which a plot rarely uses. */}
          <PreviewWindowPager />
          <div
            className="datasetPreviewPlotArea"
            ref={plotAreaRef}
            role={split ? "figure" : undefined}
            aria-label={split ? plotSummary : undefined}
            // Plotly already answers the tap itself; the browser's emulated
            // mouse events after it would count as a second tap (a double tap
            // resets the zoom) and their mouseout would unhover the values.
            onTouchEndCapture={touch ? suppressEmulatedMouse : undefined}
          >
            {split ? (
              <Plot
                data={split.figure.data}
                layout={mainLayout}
                onInitialized={readPinnedView}
                onUpdate={readPinnedView}
                // Explicit width/height so Plotly never runs plotAutoSize, which
                // reads 0px on first mount and falls back to 450px.
                style={{ width: `${width}px`, height: `${height}px` }}
                useResizeHandler={false}
                config={plotConfig}
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
          <ColorScaleLegend
            key={legend.label}
            legend={legend}
            labelFont={labelFont}
          />
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
          {t(
            touch
              ? "datasetPreviewPlotInteractionHelpTouch"
              : "datasetPreviewPlotInteractionHelp",
          )
            .split("\n")
            .map((line) => (
              <li key={line}>{line}</li>
            ))}
        </ul>
      </HelpModal>
    </div>
  );
}
