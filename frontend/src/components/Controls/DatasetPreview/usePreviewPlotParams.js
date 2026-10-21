import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import {
  variablesFrom,
  byColumnName,
  isDownwardVertical,
} from "./previewVariables.js";
import { positionRowsFor, trackIndexFor } from "./previewTrackIndex.js";
import { distanceRowsFor, trackDistancesFor } from "./previewTrackDistance.js";
import {
  colorCandidatesFor,
  colorPlotAxesFor,
  COLUMNS,
  facetPlanFor,
  resolvePanels,
  defaultVisFor,
  hasColorPlotFor,
} from "./previewFacetPlan.js";
import { parseColorsParam, formatColorsParam } from "./previewColors.js";
import {
  COLOR_LAYOUT,
  LAYOUT_PARAM,
  STEP_PARAM,
} from "../../../state/selection/previewParams.js";
import {
  formatScalesParam,
  normalizeColorScale,
  parseScalesParam,
} from "./previewColorScales.js";

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
  const variables = useMemo(
    () => [
      ...columns,
      ...(trackIndex ? [trackIndex.variable] : []),
      ...(trackDistances ? trackDistances.variables : []),
    ],
    [columns, trackIndex, trackDistances],
  );
  const variablesByName = useMemo(() => byColumnName(variables), [variables]);

  // The rows the FIGURE draws: in track order, each carrying its index and
  // distances. The table keeps `data` as it arrived.
  const plotData = useMemo(
    () => positionRowsFor(distanceRowsFor(data, trackDistances), trackIndex),
    [data, trackDistances, trackIndex],
  );

  const plan = useMemo(
    () => facetPlanFor(inspectDataset, variables, plotData),
    [inspectDataset, variables, plotData],
  );

  const defaultVis = defaultVisFor(inspectDataset);
  const visParam = searchParams.get("vis");
  const selectedVis =
    visParam === "table" || visParam === "plot" ? visParam : defaultVis;
  const setSelectedVis = useCallback(
    (vis) => setParams({ vis: vis === defaultVis ? null : vis }),
    [setParams, defaultVis],
  );

  const axisParam = searchParams.get("paxis");
  // A link may name a column this dataset does not have.
  const sharedAxis =
    axisParam && variablesByName.has(axisParam)
      ? axisParam
      : (plan && plan.sharedAxis) || null;

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

  const colorCandidates = useMemo(
    () => colorCandidatesFor(variables),
    [variables],
  );

  // The colour plot's own X and Y — not `paxis`, because a profile's shared
  // axis is its depth, which the colour plot draws DOWN rather than across.
  // A link naming a column this dataset does not have falls back, like paxis.
  const colorAxesDefault = useMemo(
    () => colorPlotAxesFor(inspectDataset, variables, plan),
    [inspectDataset, variables, plan],
  );
  const knownOr = (param, fallback) => {
    const value = searchParams.get(param);
    return value && variablesByName.has(value) ? value : fallback;
  };
  const colorX = knownOr("pcx", colorAxesDefault.x);
  const colorY = knownOr("pcy", colorAxesDefault.y);

  // In the colour plot the panels ARE the colour variables, so `pvars` carries
  // them and a switch of layout keeps what was picked. Only a column a ramp can
  // order shades a panel, and neither X nor Y is worth shading by.
  const resolveForLayout = useCallback(
    (requested) =>
      isColorLayout
        ? resolvePanels(requested, colorCandidates, colorX)
            .filter((columnName) => columnName !== colorY)
            .slice(0, MAX_COLOR_PANELS)
        : resolvePanels(requested, variables, sharedAxis),
    [isColorLayout, colorCandidates, colorX, colorY, variables, sharedAxis],
  );

  const panels = useMemo(() => {
    const requested = searchParams.has("pvars")
      ? paramToList(searchParams.get("pvars"))
      : (plan && plan.panelDefaults) || [];
    return resolveForLayout(requested);
  }, [searchParams, plan, resolveForLayout]);

  const setSharedAxis = useCallback(
    (columnName) => {
      const isDefault = plan && columnName === plan.sharedAxis;
      // Drop the new shared axis from the panels in the SAME write, or the URL
      // keeps a panel that is never drawn.
      const remaining = panels.filter((name) => name !== columnName);
      const panelsAreDefault = plan && sameList(remaining, plan.panelDefaults);
      setParams({
        paxis: isDefault ? null : columnName,
        pvars: panelsAreDefault ? null : listToParam(remaining),
      });
    },
    [setParams, plan, panels],
  );

  const setPanels = useCallback(
    (nextPanels) => {
      const cleaned = resolveForLayout(nextPanels);
      const isDefault = plan && sameList(cleaned, plan.panelDefaults);
      setParams({ pvars: isDefault ? null : listToParam(cleaned) });
    },
    [setParams, plan, resolveForLayout],
  );

  const togglePanel = useCallback(
    (columnName) => {
      setPanels(
        panels.includes(columnName)
          ? panels.filter((name) => name !== columnName)
          : [...panels, columnName],
      );
    },
    [setPanels, panels],
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
  const colorAxis = useMemo(
    () =>
      colorCandidates.some((variable) => variable.columnName === colorParam)
        ? colorParam
        : null,
    [colorCandidates, colorParam],
  );
  const colorScale = normalizeColorScale(searchParams.get("pzscale"));
  const setColorAxis = useCallback(
    (columnName) =>
      // The scale goes with the column in the SAME write: one picked for
      // salinity means nothing on temperature, and react-router hands a
      // functional updater the params from the last RENDER, so two calls in one
      // handler would leave the old scale behind.
      setParams({ pz: columnName || null, pzscale: null }),
    [setParams],
  );
  const setColorScale = useCallback(
    (name) => setParams({ pzscale: normalizeColorScale(name) }),
    [setParams],
  );

  // Like setSharedAxis: moving X or Y onto a colour variable drops it from the
  // panels in the SAME write, so the URL never keeps a panel that is not drawn.
  const setColorPlotAxis = useCallback(
    (param, columnName, defaultName) => {
      const remaining = panels.filter((name) => name !== columnName);
      const panelsAreDefault = plan && sameList(remaining, plan.panelDefaults);
      setParams({
        [param]: columnName === defaultName ? null : columnName,
        pvars: panelsAreDefault ? null : listToParam(remaining),
      });
    },
    [setParams, plan, panels],
  );
  const setColorX = useCallback(
    (columnName) => setColorPlotAxis("pcx", columnName, colorAxesDefault.x),
    [setColorPlotAxis, colorAxesDefault],
  );
  const setColorY = useCallback(
    (columnName) => setColorPlotAxis("pcy", columnName, colorAxesDefault.y),
    [setColorPlotAxis, colorAxesDefault],
  );

  // The colour plot's scale per variable, keyed by column like `pcolors`.
  const variableScales = useMemo(
    () =>
      parseScalesParam(searchParams.get("pzscales"), (columnName) =>
        variablesByName.has(columnName),
      ),
    [searchParams, variablesByName],
  );
  const setVariableScale = useCallback(
    (columnName, name) => {
      const next = { ...variableScales };
      if (normalizeColorScale(name)) next[columnName] = name;
      else delete next[columnName];
      setParams({ pzscales: formatScalesParam(next) });
    },
    [setParams, variableScales],
  );

  // Each variable on a Y axis is drawn downwards by default when it is a depth
  // or a pressure. `pyflip` lists the ones turned the other way, keyed by column
  // like `pcolors`, so a flip survives the variable leaving Y and coming back.
  const yAxisColumns = useMemo(
    () =>
      (isColorLayout
        ? [colorY]
        : plan && plan.orientation === COLUMNS
          ? [sharedAxis]
          : panels
      ).filter(Boolean),
    [isColorLayout, colorY, plan, sharedAxis, panels],
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

  // Changes with the axis set, so Plotly does not restore a zoom onto an axis
  // that no longer exists. A flipped Y counts too: a kept zoom would hold the
  // old direction's range.
  const axisSet = isColorLayout
    ? `color|${colorX || ""}|${colorY || ""}|${panels.join(",")}`
    : `${sharedAxis || ""}|${panels.join(",")}`;
  const uirevision = `${axisSet}|${[...reversedYAxes].join(",")}`;

  // The whole search string: panning the map changes the link too.
  const linkKey = searchParams.toString();

  return {
    variables,
    variablesByName,
    trackIndex,
    plotData,
    plan,
    selectedVis,
    setSelectedVis,
    sharedAxis,
    setSharedAxis,
    panels,
    setPanels,
    togglePanel,
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
    step,
    setStep,
    uirevision,
    linkKey,
  };
}
