import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";

import { variablesFrom, byColumnName } from "./previewVariables.js";
import {
  facetPlanFor,
  resolvePanels,
  defaultVisFor,
} from "./previewFacetPlan.js";
import { parseColorsParam, formatColorsParam } from "./previewColors.js";

// Plot state lives in the query string, each param written ONLY when it differs
// from the dataset type's default, so an untouched plot adds nothing to a link.
// Param names live in state/selection/previewParams.js because UrlSync has to
// carry them and SelectionProvider has to clear them.

const DEFAULT_MODE = "markers";
const PLOT_MODES = ["markers", "lines", "markers+lines"];

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
  const variables = useMemo(
    () => variablesFrom(table, inspectDataset),
    [table, inspectDataset],
  );
  const variablesByName = useMemo(() => byColumnName(variables), [variables]);

  const plan = useMemo(
    () => facetPlanFor(inspectDataset, variables, data),
    [inspectDataset, variables, data],
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

  const panels = useMemo(() => {
    const requested = searchParams.has("pvars")
      ? paramToList(searchParams.get("pvars"))
      : (plan && plan.panelDefaults) || [];
    return resolvePanels(requested, variables, sharedAxis);
  }, [searchParams, plan, variables, sharedAxis]);

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
      const cleaned = resolvePanels(nextPanels, variables, sharedAxis);
      const isDefault = plan && sameList(cleaned, plan.panelDefaults);
      setParams({ pvars: isDefault ? null : listToParam(cleaned) });
    },
    [setParams, plan, variables, sharedAxis],
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

  const modeParam = searchParams.get("pmode");
  const plotType = PLOT_MODES.includes(modeParam) ? modeParam : DEFAULT_MODE;
  const setPlotType = useCallback(
    (mode) => setParams({ pmode: mode === DEFAULT_MODE ? null : mode }),
    [setParams],
  );

  // Changes with the axis set, so Plotly does not restore a zoom onto an axis
  // that no longer exists.
  const uirevision = `${sharedAxis || ""}|${panels.join(",")}`;

  // The whole search string: panning the map changes the link too.
  const linkKey = searchParams.toString();

  return {
    variables,
    variablesByName,
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
    plotType,
    setPlotType,
    uirevision,
    linkKey,
  };
}
