import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";

import {
  variablesFrom,
  byColumnName,
  isDownwardVertical,
  withDataPresence,
} from "./previewVariables.js";
import {
  positionRowsFor,
  timeCoordinateOf,
  trackIndexFor,
} from "./previewTrackIndex.js";
import { hasMapViewFor } from "./previewMapFeatures.js";
import { distanceRowsFor, trackDistancesFor } from "./previewTrackDistance.js";
import {
  colorCandidatesFor,
  colorPlotAxesFor,
  COLUMNS,
  ROWS,
  facetPlanFor,
  resolvePanels,
  defaultVisFor,
  hasColorPlotFor,
} from "./previewFacetPlan.js";
import { parseColorsParam, formatColorsParam } from "./previewColors.js";
import {
  COLOR_LAYOUT,
  LAYOUT_PARAM,
  PLOT_PARAMS,
  STEP_PARAM,
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
];

const DEFAULT_MODE = "markers+lines";

const VIS_VALUES = new Set(["plot", "table", "map"]);

// X, Y and colour each multiply the grid, so only one of them may hold several
// variables: `list` keeps just its first when any of `others` already does.
export const onlyOneMulti = (list, ...others) =>
  others.some((other) => other.length > 1) ? list.slice(0, 1) : list;

// The arrangements, in the order the picker offers them. `panels` draws one
// variable per panel against a shared axis; `color` draws the same X and Y in
// every panel and shades each by its own variable.
export const PLOT_LAYOUTS = [
  { value: "panels", labelKey: "datasetPreviewPlotLayoutPanels" },
  { value: COLOR_LAYOUT, labelKey: "datasetPreviewPlotLayoutColor" },
];
const DEFAULT_LAYOUT = "panels";
// Each filled panel needs its height and its own colourbar; past this the
// stack scrolls apart panels meant to be read against each other.
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

// The view (plot or table) and the profile drawn say WHICH data, not how it is
// drawn, so a reset leaves them alone.
const RESETTABLE_PARAMS = PLOT_PARAMS.filter(
  (param) => param !== "vis" && param !== STEP_PARAM,
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
  const orientParam = searchParams.get("porient");
  const plan = useMemo(() => {
    if (
      !typePlan ||
      (orientParam !== ROWS && orientParam !== COLUMNS) ||
      orientParam === typePlan.orientation
    ) {
      return typePlan;
    }
    return {
      ...typePlan,
      orientation: orientParam,
      sharedReversed:
        orientParam === COLUMNS &&
        isDownwardVertical(variablesByName.get(typePlan.sharedAxis)),
    };
  }, [typePlan, orientParam, variablesByName]);

  const defaultVis = defaultVisFor(inspectDataset);
  const visParam = searchParams.get("vis");
  const mapAvailable = hasMapViewFor(inspectDataset, variables);
  const requestedVis = VIS_VALUES.has(visParam) ? visParam : defaultVis;
  // Held until /preview lands: the columns that say whether there is a
  // position to map are not known before.
  const selectedVis =
    requestedVis === "map" && columns.length && !mapAvailable
      ? "plot"
      : requestedVis;
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
  const planSharedAxis = (plan && plan.sharedAxis) || null;
  const requestedSharedAxes = useMemo(
    () => knownListOr("paxis", planSharedAxis),
    [knownListOr, planSharedAxis],
  );

  // A link may ask for the colour plot on a record that has one profile.
  const colorPlotAvailable = hasColorPlotFor(inspectDataset);
  const layoutParam = searchParams.get(LAYOUT_PARAM);
  const plotLayout =
    colorPlotAvailable &&
    PLOT_LAYOUTS.some((layout) => layout.value === layoutParam)
      ? layoutParam
      : DEFAULT_LAYOUT;
  const isColorLayout = plotLayout === COLOR_LAYOUT;
  const setPlotLayout = useCallback(
    (layout) =>
      setParams({ [LAYOUT_PARAM]: layout === DEFAULT_LAYOUT ? null : layout }),
    [setParams],
  );

  // One plot with an axis per panel variable: a single shared axis, and no
  // colour dimension, since colour says which axis a curve is read against.
  const stacked = !isColorLayout && searchParams.get("pstack") === "1";
  const setStacked = useCallback(
    (value) => setParams({ pstack: value ? "1" : null }),
    [setParams],
  );

  const colorCandidates = useMemo(
    () => colorCandidatesFor(variables),
    [variables],
  );

  // The colour plot's own X and Y — not `paxis`, because a profile's shared
  // axis is its depth, which the colour plot draws DOWN rather than across.
  // A link naming a column this dataset does not have falls back, like paxis.
  const colorAxesDefault = useMemo(
    () => colorPlotAxesFor(inspectDataset, variables, typePlan),
    [inspectDataset, variables, typePlan],
  );
  const colorXs = useMemo(
    () => knownListOr("pcx", colorAxesDefault.x),
    [knownListOr, colorAxesDefault],
  );
  const colorYs = useMemo(
    () =>
      onlyOneMulti(
        knownListOr("pcy", colorAxesDefault.y).filter(
          (name) => !colorXs.includes(name),
        ),
        colorXs,
      ),
    [knownListOr, colorAxesDefault, colorXs],
  );
  const colorX = colorXs[0] || null;
  const colorY = colorYs[0] || null;

  // In the colour plot the panels ARE the colour variables, so `pvars` carries
  // them and a switch of layout keeps what was picked. Only a column a ramp can
  // order shades a panel, and neither X nor Y is worth shading by.
  const resolveForLayout = useCallback(
    (requested) =>
      isColorLayout
        ? onlyOneMulti(
            resolvePanels(requested, colorCandidates, [
              ...colorXs,
              ...colorYs,
            ]).slice(0, MAX_COLOR_PANELS),
            colorXs,
            colorYs,
          )
        : resolvePanels(
            requested,
            variables,
            stacked ? requestedSharedAxes.slice(0, 1) : requestedSharedAxes,
          ).slice(0, stacked ? MAX_STACKED_AXES : undefined),
    [
      isColorLayout,
      stacked,
      colorCandidates,
      colorXs,
      colorYs,
      variables,
      requestedSharedAxes,
    ],
  );

  const panels = useMemo(() => {
    const requested = searchParams.has("pvars")
      ? paramToList(searchParams.get("pvars"))
      : (plan && plan.panelDefaults) || [];
    return resolveForLayout(requested);
  }, [searchParams, plan, resolveForLayout]);

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
      const isDefault = plan && sameList(columnNames, [plan.sharedAxis]);
      // Drop the new shared axes from the panels in the SAME write, or the URL
      // keeps a panel that is never drawn.
      const remaining = panels.filter((name) => !columnNames.includes(name));
      const panelsAreDefault = plan && sameList(remaining, plan.panelDefaults);
      setParams({
        paxis: isDefault ? null : columnNames.join(","),
        pvars: panelsAreDefault ? null : listToParam(remaining),
      });
    },
    [setParams, plan, panels],
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
      const cleaned = resolveForLayout(nextPanels);
      const isDefault = plan && sameList(cleaned, plan.panelDefaults);
      setParams({ pvars: isDefault ? null : listToParam(cleaned) });
    },
    [setParams, plan, resolveForLayout],
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
  // the panels keep the two they had — so it defaults to off and is written only
  // when the user turns it on.
  const colorParam = searchParams.get("pz");
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

  // Every colour column's scale, in either layout, keyed by column like
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
        pz: columnNames.length ? columnNames.join(",") : null,
        pzscales: formatScalesParam(variableScales),
        pzscale: null,
      }),
    [setParams, variableScales],
  );
  // Off: each colour column in its own scale. On: all in the first one's.
  const colorColumns = isColorLayout ? panels : colorAxes;
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
  // Like setSharedAxis: moving X or Y onto a colour variable drops it from the
  // panels in the SAME write, so the URL never keeps a panel that is not drawn.
  const setColorPlotAxes = useCallback(
    (param, columnNames, defaultName) => {
      const remaining = panels.filter((name) => !columnNames.includes(name));
      const panelsAreDefault = plan && sameList(remaining, plan.panelDefaults);
      setParams({
        [param]: sameList(columnNames, [defaultName])
          ? null
          : columnNames.join(","),
        pvars: panelsAreDefault ? null : listToParam(remaining),
      });
    },
    [setParams, plan, panels],
  );
  const setColorXs = useCallback(
    (columnNames) => setColorPlotAxes("pcx", columnNames, colorAxesDefault.x),
    [setColorPlotAxes, colorAxesDefault],
  );
  const setColorYs = useCallback(
    (columnNames) => setColorPlotAxes("pcy", columnNames, colorAxesDefault.y),
    [setColorPlotAxes, colorAxesDefault],
  );
  const setColorX = useCallback(
    (columnName) => setColorXs([columnName]),
    [setColorXs],
  );
  const setColorY = useCallback(
    (columnName) => setColorYs([columnName]),
    [setColorYs],
  );

  // Each variable on a Y axis is drawn downwards by default when it is a depth
  // or a pressure. `pyflip` lists the ones turned the other way, keyed by column
  // like `pcolors`, so a flip survives the variable leaving Y and coming back.
  const yAxisColumns = useMemo(
    () =>
      (isColorLayout
        ? colorYs
        : plan && plan.orientation === COLUMNS
          ? sharedAxes
          : panels
      ).filter(Boolean),
    [isColorLayout, colorYs, plan, sharedAxes, panels],
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

  const modeParam = searchParams.get("pmode");
  const plotType = PLOT_MODES.some((mode) => mode.value === modeParam)
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

  // The map view's colour column follows the first panel, so a plot switched
  // to the map keeps showing what it was showing.
  const mapColor = useMemo(() => {
    const colorable = new Set(colorCandidates.map((v) => v.columnName));
    const requested = searchParams.get("pmapz");
    if (colorable.has(requested)) return requested;
    return (
      panels.find((name) => colorable.has(name)) ||
      timeCoordinateOf(variables)?.columnName ||
      colorCandidates[0]?.columnName ||
      null
    );
  }, [searchParams, colorCandidates, panels, variables]);
  const setMapColor = useCallback(
    (columnName) => setParams({ pmapz: columnName }),
    [setParams],
  );
  const depthParam = Number.parseFloat(searchParams.get("pdepth"));
  const mapDepth = Number.isFinite(depthParam) ? depthParam : null;
  const setMapDepth = useCallback(
    (depth) => setParams({ pdepth: depth === null ? null : String(depth) }),
    [setParams],
  );

  // Changes with the axis set, so Plotly does not restore a zoom onto an axis
  // that no longer exists. A flipped Y counts too: a kept zoom would hold the
  // old direction's range.
  const axisSet = isColorLayout
    ? `color|${colorXs.join(",")}|${colorYs.join(",")}|${panels.join(",")}`
    : `${stacked ? "stack|" : ""}${sharedAxes.join(",")}|${panels.join(",")}|${colorAxes.join(",")}`;
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

  return {
    variables,
    variablesByName,
    trackIndex,
    plotData,
    plan,
    selectedVis,
    setSelectedVis,
    mapAvailable,
    mapColor,
    setMapColor,
    mapDepth,
    setMapDepth,
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
    plotLayout,
    setPlotLayout,
    colorPlotAvailable,
    stacked,
    setStacked,
    colorX,
    setColorX,
    colorY,
    setColorY,
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
    step,
    setStep,
    uirevision,
    linkKey,
    plotCustomized,
    resetPlot,
  };
}
