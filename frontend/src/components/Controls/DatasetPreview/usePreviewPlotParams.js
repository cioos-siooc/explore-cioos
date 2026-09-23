import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { variablesFrom, byColumnName } from "./previewVariables.js";
import { positionRowsFor, trackIndexFor } from "./previewTrackIndex.js";
import {
  colorCandidatesFor,
  facetPlanFor,
  resolvePanels,
  defaultVisFor,
} from "./previewFacetPlan.js";
import { parseColorsParam, formatColorsParam } from "./previewColors.js";
import { STEP_PARAM } from "../../../state/selection/previewParams.js";
import { normalizeColorScale } from "./previewColorScales.js";

// Everything that describes the plot on screen, kept in the query string so a
// link reproduces it — the same arrangement SelectionProvider already uses for
// the open dataset page (?dataset=…&server=…), and for the same two payoffs:
// one source of truth, and Back/Forward for free.
//
// Every param is written ONLY when the value differs from the default the dataset
// type implies, and deleted again when it returns to it. So an untouched plot
// contributes nothing to the link, which is what keeps a shared URL from growing
// a tail of settings nobody changed. See useUrlSync for the same rule applied to
// the map's layer switches.
//
// The param names live in state/selection/previewParams.js, because UrlSync has
// to carry them through and SelectionProvider has to clear them.

const DEFAULT_MODE = "markers";
const PLOT_MODES = ["markers", "lines", "markers+lines"];

// A panel list rides in one param rather than one param per panel: the count is
// unbounded (as many variables as the dataset has), and pvars=A,B,C stays
// readable where pv1=A&pv2=B&pv3=C does not.
//
// Unticking every variable is a real state and must not read as "use the
// defaults", so it writes a sentinel. A bare '-' cannot collide with a column
// name: ERDDAP variable names are CF-legal identifiers (letters, digits,
// underscore), so none of them is '-'.
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

  // One writer for all of them. A null/undefined/'' value deletes its param, so
  // "back to the default" and "never set" produce the same URL.
  //
  // Always replace: adjusting a dropdown is not a navigation, and a history entry
  // per twiddle would bury the entries that do mean something (opening the
  // dataset page, opening the record). This mirrors UrlSync's own reasoning.
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

  // Every column of the payload, described. Empty until /preview lands, which is
  // why the vis default below must not depend on it.
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

  // The index is offered like any other column, so the axis picker, the label
  // editor and the colour candidates need no special case for it.
  const variables = useMemo(
    () => (trackIndex ? [...columns, trackIndex.variable] : columns),
    [columns, trackIndex],
  );
  const variablesByName = useMemo(() => byColumnName(variables), [variables]);

  // The rows the FIGURE draws: in track order, each carrying its index. The
  // table keeps `data` as it arrived.
  const plotData = useMemo(
    () => positionRowsFor(data, trackIndex),
    [data, trackIndex],
  );

  // The layout this dataset type implies: which axis the panels share, which way
  // they stack, and which variable opens.
  const plan = useMemo(
    () => facetPlanFor(inspectDataset, variables, plotData),
    [inspectDataset, variables, plotData],
  );

  // Table or plot. Only the deviation is stored, so `vis` appears in the link
  // exactly when the user overrode what this dataset type opens on. Decided from
  // cdm_data_type alone so it cannot flip when the payload arrives.
  const defaultVis = defaultVisFor(inspectDataset);
  const visParam = searchParams.get("vis");
  const selectedVis =
    visParam === "table" || visParam === "plot" ? visParam : defaultVis;
  const setSelectedVis = useCallback(
    (vis) => setParams({ vis: vis === defaultVis ? null : vis }),
    [setParams, defaultVis],
  );

  const axisParam = searchParams.get("paxis");
  // A link may name a column this dataset does not have (a different dataset, a
  // renamed variable); fall back rather than draw an empty axis.
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
      // The shared axis is never also a panel. Moving it onto a selected column
      // has to drop that column from the panel set in the SAME write, or the
      // next render resolves it away and the URL keeps a panel that is not drawn.
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

  // One colour per variable, keyed by COLUMN NAME and not by panel index: a
  // colour then survives unticking a variable and ticking it again, and a link's
  // colours cannot slide onto the wrong panels when the selection differs.
  //
  // This replaces `pcolor`, which named the ONE variable whose values shaded
  // every panel. See previewColors.js for the codec and previewParams.js for why
  // the old param is retired rather than reused.
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
      // No colour is the default colour: dropping the entry is what deletes it
      // from the link, so "back to what the dataset says" leaves no trace.
      else delete next[columnName];
      setParams({ pcolors: formatColorsParam(next) });
    },
    [setParams, variableColors],
  );

  // The third dimension: one column shading every panel. Not a second axis —
  // the panels keep the two they had — so it defaults to off and is written only
  // when the user turns it on.
  const colorCandidates = useMemo(
    () => colorCandidatesFor(variables),
    [variables],
  );
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

  const modeParam = searchParams.get("pmode");
  const plotType = PLOT_MODES.includes(modeParam) ? modeParam : DEFAULT_MODE;
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

  // Changes whenever the axis SET changes, so Plotly does not try to restore a
  // zoom onto an axis that no longer exists after a panel is added or removed.
  const uirevision = `${sharedAxis || ""}|${panels.join(",")}`;

  // Anything that alters the link the Copy button would hand over. The whole
  // search string, not just the plot params: panning the map changes the link
  // too, and a button still saying "Copied!" would be claiming a stale URL.
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
    plotType,
    setPlotType,
    step,
    setStep,
    uirevision,
    linkKey,
  };
}
