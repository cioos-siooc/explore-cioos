import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";

import {
  variablesFrom,
  byColumnName,
  isDownwardVertical,
  isTimeLike,
  withDataPresence,
} from "./previewVariables.js";
import {
  POSITION_INDEX_COLUMN,
  positionRowsFor,
  trackIndexFor,
} from "./previewTrackIndex.js";
import {
  EUCLIDEAN_DISTANCE_COLUMN,
  TOTAL_DISTANCE_TRAVELED_COLUMN,
  distanceRowsFor,
  trackDistancesFor,
} from "./previewTrackDistance.js";
import { CONTOUR_MODE } from "./previewFacetFigure.js";
import {
  colorCandidatesFor,
  colocatedVerticalFor,
  COLUMNS,
  ROWS,
  facetPlanFor,
  resolvePanels,
  defaultVisFor,
} from "./previewFacetPlan.js";
import { parseColorsParam, formatColorsParam } from "./previewColors.js";
import {
  PLOT_PARAMS,
  STEP_PARAM,
  ROWS_PARAM,
  BEFORE_PARAM,
  DEFAULT_ROW_LIMIT,
  parseRowLimit,
} from "../../../state/selection/previewParams.js";
import {
  autoScaleNameFor,
  formatScalesParam,
  normalizeColorScale,
  parseScalesParam,
} from "./previewColorScales.js";
import { MAX_STACKED_AXES } from "./previewFacetSizing.js";

// Plot state lives in the query string, each param written ONLY when it differs
// from the dataset type's default, so an untouched plot adds nothing to a link.
// Param names live in state/selection/previewParams.js because UrlSync has to
// carry them and SelectionProvider has to clear them.

// The modes, in the order the picker offers them. One table: the hook validates
// against it and the picker renders from it, so a mode can never be reachable in
// a link but missing from the menu. `markers+lines` has no key of its own — the
// bundle spells it `markersAndLine`.
export const PLOT_MODES = [
  { value: "markers", labelKey: "markers" },
  { value: "lines", labelKey: "line" },
  { value: "markers+lines", labelKey: "markersAndLine" },
  { value: CONTOUR_MODE, labelKey: "contour" },
];

const DEFAULT_MODE = "markers+lines";

// What a contour fills between: casts side by side along time or the track.
const TRACK_COLUMNS = new Set([
  POSITION_INDEX_COLUMN,
  TOTAL_DISTANCE_TRAVELED_COLUMN,
  EUCLIDEAN_DISTANCE_COLUMN,
]);

export const ACROSS = "across";
export const DOWN = "down";

// X, Y and colour each multiply the grid, so only one of them may hold several
// variables: `list` keeps just its first when any of `others` already does.
export const onlyOneMulti = (list, ...others) =>
  others.some((other) => other.length > 1) ? list.slice(0, 1) : list;

// Each colour column repeats every panel with its own colourbar; past this the
// grid scrolls apart panels meant to be read against each other.
export const MAX_COLOR_PANELS = 5;

// Unticking every variable must not read as "use the defaults", so it writes a
// sentinel; '-' cannot collide with a CF-legal ERDDAP variable name.
const NO_PANELS = "-";
const listToParam = (columnNames) =>
  columnNames.length ? columnNames.join(",") : NO_PANELS;
const paramToList = (value) =>
  value === NO_PANELS
    ? []
    : (value || "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);

// The view (plot or table), the profile drawn and the rows fetched say WHICH
// data, not how it is drawn, so a reset leaves them alone.
const DATA_PARAMS = new Set(["vis", STEP_PARAM, ROWS_PARAM, BEFORE_PARAM]);
const RESETTABLE_PARAMS = PLOT_PARAMS.filter(
  (param) => !DATA_PARAMS.has(param),
);

const sameList = (a, b) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export default function usePreviewPlotParams(inspectDataset, table, data) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useTranslation();

  // An empty value deletes its param. Always replace: a history entry per
  // dropdown twiddle would bury the ones that matter.
  const setParams = useCallback(
    (changes) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          Object.entries(changes).forEach(([param, value]) => {
            if (value === null || value === undefined || value === "") {
              next.delete(param);
            } else {
              next.set(param, value);
            }
          });
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Empty until /preview lands, which is why the vis default must not use it.
  const columns = useMemo(
    () => variablesFrom(table, inspectDataset),
    [table, inspectDataset],
  );

  // A trajectory's positions, ranked by time. Null for every other type. The
  // axis label is translated here because the module that builds it is pure —
  // it is the only user-visible string in the whole chain that is not a column
  // name the publisher chose.
  const positionAxisLabel = t("previewPositionAxis");
  const trackIndex = useMemo(
    () => trackIndexFor(inspectDataset, columns, data, positionAxisLabel),
    [inspectDataset, columns, data, positionAxisLabel],
  );

  // A track's distances in km, for Trajectory and TrajectoryProfile alike.
  const totalDistanceTraveledLabel = t("previewTotalDistanceTraveledAxis");
  const euclideanDistanceLabel = t("previewEuclideanDistanceAxis");
  const trackDistances = useMemo(
    () =>
      trackDistancesFor(inspectDataset, columns, data, {
        totalDistanceTraveled: totalDistanceTraveledLabel,
        euclideanDistance: euclideanDistanceLabel,
      }),
    [
      inspectDataset,
      columns,
      data,
      totalDistanceTraveledLabel,
      euclideanDistanceLabel,
    ],
  );

  // The index and distances are offered like any other column, so the axis
  // picker, the label editor and the colour candidates need no special case.
  // The rows the FIGURE draws: in track order, each carrying its index and
  // distances. The table keeps `data` as it arrived.
  const plotData = useMemo(
    () => positionRowsFor(distanceRowsFor(data, trackDistances), trackIndex),
    [data, trackDistances, trackIndex],
  );

  // Each marked with whether the rows hold any of it, so the defaults and the
  // pickers can put the columns that would draw something first.
  const variables = useMemo(
    () =>
      withDataPresence(
        [
          ...columns,
          ...(trackIndex ? [trackIndex.variable] : []),
          ...(trackDistances ? trackDistances.variables : []),
        ],
        plotData,
      ),
    [columns, trackIndex, trackDistances, plotData],
  );
  const variablesByName = useMemo(() => byColumnName(variables), [variables]);

  // The type's own plan, then the plan as drawn: `porient` moves the panels to
  // the other axis, so either X or Y can hold several variables, one at a time.
  const typePlan = useMemo(
    () => facetPlanFor(inspectDataset, variables, plotData),
    [inspectDataset, variables, plotData],
  );
  // `pzrows` stacks the colour columns' repeats as rows, or lays them across.
  const orientParam = searchParams.get("porient");
  const colorRowsParam = searchParams.get("pzrows");
  const plan = useMemo(() => {
    if (!typePlan) return typePlan;
    const colorRows =
      colorRowsParam === "1" || colorRowsParam === "0"
        ? colorRowsParam === "1"
        : typePlan.colorRows;
    if (
      (orientParam !== ROWS && orientParam !== COLUMNS) ||
      orientParam === typePlan.orientation
    ) {
      return { ...typePlan, colorRows };
    }
    return {
      ...typePlan,
      colorRows,
      orientation: orientParam,
      sharedReversed:
        orientParam === COLUMNS &&
        isDownwardVertical(variablesByName.get(typePlan.sharedAxis)),
    };
  }, [typePlan, orientParam, colorRowsParam, variablesByName]);

  const defaultVis = defaultVisFor(inspectDataset);
  const visParam = searchParams.get("vis");
  const selectedVis =
    visParam === "table" || visParam === "plot" ? visParam : defaultVis;
  const setSelectedVis = useCallback(
    (vis) => setParams({ vis: vis === defaultVis ? null : vis }),
    [setParams, defaultVis],
  );

  // A comma list each, so X and Y can both hold several variables: the grid
  // draws every pair. A column this dataset does not have is dropped, and a
  // list left empty falls back to the default.
  const knownListOr = useCallback(
    (param, fallback, known = (name) => variablesByName.has(name)) => {
      const listed = [...new Set(paramToList(searchParams.get(param)))].filter(
        known,
      );
      return listed.length ? listed : fallback ? [fallback] : [];
    },
    [searchParams, variablesByName],
  );
  const panelRequest = useMemo(
    () =>
      searchParams.has("pvars")
        ? paramToList(searchParams.get("pvars"))
        : (plan && plan.panelDefaults) || [],
    [searchParams, plan],
  );
  // The default vertical axis is the one that shares rows with what is drawn
  // against it; a named one is left alone.
  const colocatedWith = useCallback(
    (vertical) =>
      vertical &&
      colocatedVerticalFor(
        variables,
        plotData,
        vertical,
        panelRequest.filter((name) => variablesByName.has(name)),
      ),
    [variables, plotData, panelRequest, variablesByName],
  );
  const planSharedAxis = useMemo(
    () =>
      plan && plan.orientation === COLUMNS
        ? colocatedWith(plan.sharedAxis)
        : (plan && plan.sharedAxis) || null,
    [plan, colocatedWith],
  );
  const requestedSharedAxes = useMemo(
    () => knownListOr("paxis", planSharedAxis),
    [knownListOr, planSharedAxis],
  );

  // One plot with an axis per panel variable: a single shared axis, and no
  // colour dimension, since colour says which axis a curve is read against.
  const stacked = searchParams.get("pstack") === "1";
  const setStacked = useCallback(
    (value) => setParams({ pstack: value ? "1" : null }),
    [setParams],
  );

  const colorCandidates = useMemo(
    () => colorCandidatesFor(variables),
    [variables],
  );

  const resolveRequestedPanels = useCallback(
    (requested) =>
      resolvePanels(
        requested,
        variables,
        stacked ? requestedSharedAxes.slice(0, 1) : requestedSharedAxes,
      ).slice(0, stacked ? MAX_STACKED_AXES : undefined),
    [variables, stacked, requestedSharedAxes],
  );
  const panels = useMemo(
    () => resolveRequestedPanels(panelRequest),
    [panelRequest, resolveRequestedPanels],
  );

  // The panels are what the panel layout is for, so they keep their several.
  const sharedAxes = useMemo(
    () =>
      stacked
        ? requestedSharedAxes.slice(0, 1)
        : onlyOneMulti(requestedSharedAxes, panels),
    [stacked, requestedSharedAxes, panels],
  );
  const sharedAxis = sharedAxes[0] || null;

  const setSharedAxes = useCallback(
    (columnNames) => {
      const isDefault = plan && sameList(columnNames, [planSharedAxis]);
      // Drop the new shared axes from the panels in the SAME write, or the URL
      // keeps a panel that is never drawn.
      const remaining = panels.filter((name) => !columnNames.includes(name));
      const panelsAreDefault = plan && sameList(remaining, plan.panelDefaults);
      setParams({
        paxis: isDefault ? null : columnNames.join(","),
        pvars: panelsAreDefault ? null : listToParam(remaining),
      });
    },
    [setParams, plan, panels, planSharedAxis],
  );
  const setSharedAxis = useCallback(
    (columnName) => setSharedAxes([columnName]),
    [setSharedAxes],
  );

  // A second variable on the single axis: it becomes the panels' axis, and the
  // one panel left on the other side becomes the shared axis. One write.
  const flipPanelAxis = useCallback(
    (nextShared, nextPanels) => {
      if (!typePlan) return;
      const orientation = plan.orientation === COLUMNS ? ROWS : COLUMNS;
      const cleaned = resolvePanels(nextPanels, variables, nextShared);
      setParams({
        porient: orientation === typePlan.orientation ? null : orientation,
        paxis: nextShared === typePlan.sharedAxis ? null : nextShared,
        pvars: sameList(cleaned, typePlan.panelDefaults)
          ? null
          : listToParam(cleaned),
      });
    },
    [setParams, typePlan, plan, variables],
  );

  const setPanels = useCallback(
    (nextPanels) => {
      const cleaned = resolveRequestedPanels(nextPanels);
      const isDefault = plan && sameList(cleaned, plan.panelDefaults);
      setParams({ pvars: isDefault ? null : listToParam(cleaned) });
    },
    [setParams, plan, resolveRequestedPanels],
  );

  // Keyed by column name, not panel index, so a colour survives untick/retick and
  // cannot slide onto the wrong panel when a link's selection differs.
  const variableColors = useMemo(
    () =>
      parseColorsParam(searchParams.get("pcolors"), (columnName) =>
        variablesByName.has(columnName),
      ),
    [searchParams, variablesByName],
  );
  const setVariableColor = useCallback(
    (columnName, color) => {
      const next = { ...variableColors };
      if (color) next[columnName] = color;
      else delete next[columnName];
      setParams({ pcolors: formatColorsParam(next) });
    },
    [setParams, variableColors],
  );

  // The third dimension: one column shading every panel. Not a second axis —
  // the panels keep the two they had — so it is off unless the type's plan
  // shades by default (a section's EOVs); turning a default off writes the
  // sentinel.
  const colorDefaults = useMemo(
    () => (plan && plan.colorDefaults) || [],
    [plan],
  );
  const colorParam = searchParams.has("pz")
    ? searchParams.get("pz")
    : colorDefaults.join(",");
  // A link may name a column this dataset does not have, or one a ramp cannot
  // order. OFF rather than substituted — unlike paxis, which falls back to the
  // plan's own axis: "colour by something else instead" is a decision nobody
  // made.
  // Several columns make a grid: every panel once per colour column.
  const colorAxes = useMemo(
    () =>
      stacked
        ? []
        : onlyOneMulti(
            [...new Set(paramToList(colorParam))]
              .filter((name) =>
                colorCandidates.some(
                  (variable) => variable.columnName === name,
                ),
              )
              .slice(0, MAX_COLOR_PANELS),
            panels,
            sharedAxes,
          ),
    [stacked, colorCandidates, colorParam, panels, sharedAxes],
  );
  const colorAxis = colorAxes[0] ?? null;

  // Every colour column's scale, keyed by column like
  // `pcolors`. A link from before per-column scales carries one `pzscale`,
  // which meant the first colour column's.
  const legacyScale = normalizeColorScale(searchParams.get("pzscale"));
  const variableScales = useMemo(() => {
    const scales = parseScalesParam(
      searchParams.get("pzscales"),
      (columnName) => variablesByName.has(columnName),
    );
    return legacyScale && colorAxis && !scales[colorAxis]
      ? { ...scales, [colorAxis]: legacyScale }
      : scales;
  }, [searchParams, variablesByName, legacyScale, colorAxis]);
  // Both write `pzscales` whole, folding a legacy `pzscale` in, so it stays
  // with the column it was picked for.
  const setVariableScale = useCallback(
    (columnName, name) => {
      const next = { ...variableScales };
      if (normalizeColorScale(name)) next[columnName] = name;
      else delete next[columnName];
      setParams({ pzscales: formatScalesParam(next), pzscale: null });
    },
    [setParams, variableScales],
  );
  const setColorAxes = useCallback(
    (columnNames) =>
      setParams({
        pz: sameList(columnNames, colorDefaults)
          ? null
          : listToParam(columnNames),
        pzscales: formatScalesParam(variableScales),
        pzscale: null,
      }),
    [setParams, variableScales, colorDefaults],
  );
  // Off: each colour column in its own scale. On: all in the first one's.
  const colorColumns = colorAxes;
  const sharedColorScale = searchParams.get("pzshare") === "1";
  const setSharedColorScale = useCallback(
    (shared) => setParams({ pzshare: shared ? "1" : null }),
    [setParams],
  );
  const scalesInUse = useMemo(() => {
    if (!sharedColorScale || colorColumns.length < 2) return variableScales;
    const [first] = colorColumns;
    const name =
      variableScales[first] || autoScaleNameFor(variablesByName.get(first));
    return {
      ...variableScales,
      ...Object.fromEntries(colorColumns.map((column) => [column, name])),
    };
  }, [sharedColorScale, colorColumns, variableScales, variablesByName]);

  const setColorAxis = useCallback(
    (columnName) => setColorAxes(columnName ? [columnName] : []),
    [setColorAxes],
  );

  // Only one of the panels, the shared axes and the colour columns may hold
  // several, so the facets always run one way: ACROSS or DOWN. Colour repeats
  // turn on their own; panels and shared axes turn by swapping the plot's
  // axes, since a shared axis has to stay shared.
  const facetCount = stacked
    ? 1
    : Math.max(panels.length, sharedAxes.length, colorAxes.length);
  const facetsByColor = !stacked && colorAxes.length > 1;
  const facetDirection = useMemo(() => {
    if (!plan) return null;
    if (facetsByColor) return plan.colorRows ? DOWN : ACROSS;
    const panelsAcross = plan.orientation === COLUMNS;
    return panels.length > 1 === panelsAcross ? ACROSS : DOWN;
  }, [plan, facetsByColor, panels.length]);
  const setFacetDirection = useCallback(
    (direction) => {
      if (!typePlan || direction === facetDirection) return;
      if (facetsByColor) {
        const colorRows = direction === DOWN;
        setParams({
          pzrows:
            colorRows === Boolean(typePlan.colorRows)
              ? null
              : colorRows
                ? "1"
                : "0",
        });
        return;
      }
      const orientation = plan.orientation === COLUMNS ? ROWS : COLUMNS;
      setParams({
        porient: orientation === typePlan.orientation ? null : orientation,
      });
    },
    [setParams, typePlan, plan, facetDirection, facetsByColor],
  );

  // Each variable on a Y axis is drawn downwards by default when it is a depth
  // or a pressure. `pyflip` lists the ones turned the other way, keyed by column
  // like `pcolors`, so a flip survives the variable leaving Y and coming back.
  const yAxisColumns = useMemo(
    () =>
      (plan && plan.orientation === COLUMNS ? sharedAxes : panels).filter(
        Boolean,
      ),
    [plan, sharedAxes, panels],
  );
  const reversedByDefault = useCallback(
    (columnName) => isDownwardVertical(variablesByName.get(columnName)),
    [variablesByName],
  );
  const flippedColumns = useMemo(
    () => paramToList(searchParams.get("pyflip")),
    [searchParams],
  );
  const reversedYAxes = useMemo(
    () =>
      new Set(
        yAxisColumns.filter(
          (columnName) =>
            reversedByDefault(columnName) !==
            flippedColumns.includes(columnName),
        ),
      ),
    [yAxisColumns, reversedByDefault, flippedColumns],
  );
  const setYAxisReversed = useCallback(
    (columnName, reversed) => {
      const next = flippedColumns.filter((name) => name !== columnName);
      if (reversed !== reversedByDefault(columnName)) next.push(columnName);
      setParams({ pyflip: next.length ? next.join(",") : null });
    },
    [setParams, flippedColumns, reversedByDefault],
  );

  // A contour only reads as a section: casts across, depth down, shaded.
  const xAxisColumns = useMemo(
    () => (plan && plan.orientation === COLUMNS ? panels : sharedAxes),
    [plan, panels, sharedAxes],
  );
  const contourAvailable =
    colorAxes.length > 0 &&
    xAxisColumns.length > 0 &&
    yAxisColumns.length > 0 &&
    xAxisColumns.every(
      (columnName) =>
        TRACK_COLUMNS.has(columnName) ||
        isTimeLike(variablesByName.get(columnName)),
    ) &&
    yAxisColumns.every(reversedByDefault);
  const plotModes = useMemo(
    () =>
      contourAvailable
        ? PLOT_MODES
        : PLOT_MODES.filter((mode) => mode.value !== CONTOUR_MODE),
    [contourAvailable],
  );

  // A contour the link asks for where none can be drawn is the default, but
  // stays in the link for when the axes come back.
  const modeParam = searchParams.get("pmode");
  const plotType = plotModes.some((mode) => mode.value === modeParam)
    ? modeParam
    : DEFAULT_MODE;
  const setPlotType = useCallback(
    (mode) => setParams({ pmode: mode === DEFAULT_MODE ? null : mode }),
    [setParams],
  );

  // Which profile inside the record is drawn, or null for the window /preview
  // returns on its own. SelectionProvider reads the same param to build the
  // fetch — this half is only what the slider binds to.
  const step = searchParams.get(STEP_PARAM) || null;
  const setStep = useCallback(
    (value) => setParams({ [STEP_PARAM]: value }),
    [setParams],
  );

  // How much of the record is fetched, and from where back. SelectionProvider
  // reads the same params to build the fetch.
  const rowLimit = parseRowLimit(searchParams.get(ROWS_PARAM));
  const setRowLimit = useCallback(
    (limit) =>
      setParams({ [ROWS_PARAM]: limit === DEFAULT_ROW_LIMIT ? null : limit }),
    [setParams],
  );
  const before = searchParams.get(BEFORE_PARAM) || null;
  const setBefore = useCallback(
    (instant) => setParams({ [BEFORE_PARAM]: instant }),
    [setParams],
  );

  // Changes with the axis set, so Plotly does not restore a zoom onto an axis
  // that no longer exists. A flipped Y counts too: a kept zoom would hold the
  // old direction's range.
  const axisSet = `${stacked ? "stack|" : ""}${plan?.orientation}|${plan?.colorRows ? "zrows|" : ""}${sharedAxes.join(",")}|${panels.join(",")}|${colorAxes.join(",")}`;
  const uirevision = `${axisSet}|${[...reversedYAxes].join(",")}`;

  // The whole search string: panning the map changes the link too.
  const linkKey = searchParams.toString();

  const plotCustomized = RESETTABLE_PARAMS.some((param) =>
    searchParams.has(param),
  );
  const resetPlot = useCallback(
    () =>
      setParams(
        Object.fromEntries(RESETTABLE_PARAMS.map((param) => [param, null])),
      ),
    [setParams],
  );

  // One identity per change, so the provider value built from it stays stable.
  return useMemo(
    () => ({
      variables,
      variablesByName,
      trackIndex,
      plotData,
      plan,
      selectedVis,
      setSelectedVis,
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
      colorAxis,
      setColorAxis,
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
      step,
      setStep,
      rowLimit,
      setRowLimit,
      before,
      setBefore,
      uirevision,
      linkKey,
      plotCustomized,
      resetPlot,
    }),
    [
      variables,
      variablesByName,
      trackIndex,
      plotData,
      plan,
      selectedVis,
      setSelectedVis,
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
      colorAxis,
      setColorAxis,
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
      step,
      setStep,
      rowLimit,
      setRowLimit,
      before,
      setBefore,
      uirevision,
      linkKey,
      plotCustomized,
      resetPlot,
    ],
  );
}
