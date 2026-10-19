// Explicit axis domains rather than layout.grid: Plotly resolves a grid only
// against a real DOM, and computing them here (see previewFacetSizing) keeps the
// layout assertable under `node --test`. Every label is an axis title, so it
// runs along its axis (a y axis title sideways) and gets `automargin`.

import { COLUMNS, ROWS } from "./previewFacetPlan.js";
import {
  isDownwardVertical,
  labelFor,
  shortLabelFor,
} from "./previewVariables.js";
import { defaultColorFor } from "./previewColors.js";
import {
  colorDimensionFor,
  colorScaleForVariable,
  legendTicksFor,
} from "./previewColorScales.js";
import { coloredLineBinsFor, lineBinLimitFor } from "./previewColoredLine.js";
import {
  ellipsize,
  maxCharsFor,
  titleLinesFor,
  wrapLabel,
  wrapTitleFor,
  HOVER_FONT_PX,
  LABEL_FONT_PX,
  TICK_FONT_PX,
  TITLE_FONT_PX,
} from "./previewLabelText.js";
import {
  boxBudgetFor,
  domainsFor,
  heightBudgetFor,
  marginFor,
  plotHeightFor,
  plotWidthFor,
  COLORBAR_ROOM_PX,
  COLUMN_GAP,
  PINNED_AXIS_LINES,
  ROW_GAP,
  TITLE_PAD_PX,
} from "./previewFacetSizing.js";

// How much of a name a hover row may spend. Long enough for "Practical
// Salinity", short enough that six rows stay a box rather than a paragraph.
const HOVER_NAME_CHARS = 22;

const axisKey = (letter, index) =>
  index === 0 ? `${letter}axis` : `${letter}axis${index + 1}`;
const axisRef = (letter, index) =>
  index === 0 ? letter : `${letter}${index + 1}`;

// The hover's line, on the SHARED axis alone — a second one per panel would be
// noise. `across` is what makes it span every panel: Plotly draws it between the
// lowest and highest domain of that axis's counter axes.
//
// A fixed grey because the default is the hovered POINT's colour, and with a
// colour dimension set that tints the line by the ramp value it is pointing at —
// the line is a guide, not data.
const SPIKE_COLOR = "#6c757d";
const sharedAxisSpike = {
  showspikes: true,
  spikemode: "across",
  spikesnap: "hovered data",
  spikethickness: 1, // Plotly's own default is 3, which reads as a rule
  spikedash: "dot",
  spikecolor: SPIKE_COLOR,
};

const axisTitle = (text) => ({
  text,
  font: { size: LABEL_FONT_PX },
  standoff: 6,
});

// The two arrangements, as closed alternatives rather than one boolean asked a
// dozen times. Each owns the letters its axes take — which is what wires the
// traces — the gap between panels, and how the hover is gathered.
const COLUMNS_LAYOUT = {
  gap: COLUMN_GAP,
  shared: "y",
  panel: "x",
  hovermode: "y unified",
  // Plotly rotates every hover box by a fixed 60° when hovermode is "y" and
  // more than one is drawn — YANGLE, and no attribute turns it off. Unified
  // gathers them into one horizontal box instead.
  unifiedHover: true,
  panelTitleSide: "top",
};

const ROWS_LAYOUT = {
  gap: ROW_GAP,
  shared: "x",
  panel: "y",
  // Not rotated, so a stack keeps one box per panel.
  hovermode: "x",
  unifiedHover: false,
  panelTitleSide: null,
};

const ARRANGEMENTS = { [COLUMNS]: COLUMNS_LAYOUT, [ROWS]: ROWS_LAYOUT };

const TITLE_JOIN = " — ";
const VALUE_JOIN = ", ";
// A record window can span several profiles; naming all would be a paragraph.
const MAX_TITLE_VALUES = 3;

// First seen first; blanks and ERDDAP's "NaN" dropped.
function distinctValues(data, columnName) {
  const seen = [];
  const known = new Set();
  (data || []).forEach((row) => {
    const value = row && row[columnName];
    if (value === null || value === undefined) return;
    const text = String(value).trim();
    if (!text || text === "NaN" || known.has(text)) return;
    known.add(text);
    seen.push(text);
  });
  return seen;
}

// One "<label>: <value>" per cf_role column, in ERDDAP's order. For a
// TimeSeriesProfile the record id is the station while what is drawn is one
// profile, which nothing else on screen names.
export function recordTitleFor({ plan, variablesByName, data }) {
  const columns = (plan && plan.titleColumns) || [];
  return columns
    .map((columnName) => {
      const values = distinctValues(data, columnName);
      if (!values.length) return null;
      const shown = values.slice(0, MAX_TITLE_VALUES).join(VALUE_JOIN);
      const rest = values.length - MAX_TITLE_VALUES;
      const variable = variablesByName && variablesByName.get(columnName);
      const label = shortLabelFor(variable) || columnName;
      return `${label}: ${shown}${rest > 0 ? ` +${rest}` : ""}`;
    })
    .filter(Boolean)
    .join(TITLE_JOIN);
}

/**
 * The box the figure is drawn in, and the title that shapes it.
 *
 * The order is the whole point of gathering these into one function: the width
 * does not depend on the title, so it is chosen first; the title's line count
 * follows from that width; and only then is the height known. Any other order
 * needs a measurement that does not exist yet.
 */
export function plotBoxFor({
  plan,
  variablesByName,
  data,
  panelCount,
  availableHeight,
  measured = {},
  withTitle = true,
  orientation = plan.orientation, // the colour plot always stacks
}) {
  const title = withTitle
    ? recordTitleFor({ plan, variablesByName, data })
    : "";
  const width = plotWidthFor(
    orientation,
    panelCount,
    boxBudgetFor(measured.width),
  );
  const titleLines = titleLinesFor(title, width);
  const height = plotHeightFor(
    orientation,
    panelCount,
    heightBudgetFor(availableHeight, measured.height),
    titleLines,
  );
  return { title, width, height, titleLines };
}

// What the figure calls a column, on an axis and in a hover. Shared by both
// layouts so a rename reads the same in each.
function labellerFor(variablesByName, labels) {
  const titleFor = (columnName) => {
    const custom = labels[columnName] && labels[columnName].trim();
    const variable = variablesByName.get(columnName);
    if (!custom) return labelFor(variable);
    return variable && variable.unit
      ? `${custom} ( ${variable.unit} )`
      : custom;
  };

  // What the hover calls a column: the user's rename, else its long_name. Capped
  // because a box is open on every panel at once and one 125-character long_name
  // would stretch it across the figure.
  const hoverNameFor = (columnName) => {
    const custom = labels[columnName] && labels[columnName].trim();
    const name =
      custom || shortLabelFor(variablesByName.get(columnName)) || columnName;
    return ellipsize(name, HOVER_NAME_CHARS);
  };
  // After the value rather than after the name: "3.21 degree_C" reads as a
  // measurement, where "TE90_01 ( degree_C ): 3.21" reads as a column heading.
  const hoverUnitFor = (columnName) => {
    const variable = variablesByName.get(columnName);
    return variable && variable.unit ? ` ${variable.unit}` : "";
  };
  const hoverLine = (columnName, token) =>
    `${hoverNameFor(columnName)}: ${token}${hoverUnitFor(columnName)}`;

  return { titleFor, hoverLine };
}

// title.automargin deliberately unset: it would grow the margin inside a fixed
// height and silently shrink panels below MIN_PANEL_PX.
const layoutTitleFor = (wrappedTitle) => ({
  text: wrappedTitle,
  font: { size: TITLE_FONT_PX },
  xref: "container",
  x: 0.5,
  xanchor: "center",
  yref: "container",
  y: 1,
  yanchor: "top",
  pad: { t: TITLE_PAD_PX },
});

/**
 * @param plan          from facetPlanFor()
 * @param variablesByName Map columnName -> variable (previewVariables)
 * @param panels        resolved column names, one panel each
 * @param sharedAxis    column name shared by every panel
 * @param data          array of row objects
 * @param colors        { [columnName]: '#rrggbb' } — the user's overrides only
 * @param labels        { [columnName]: customLabel }
 * @param title         plain text, from recordTitleFor(); wrapped here
 * @param mode          'markers' | 'lines' | 'markers+lines'
 * @param colorAxis     column whose values shade EVERY panel, or null
 * @param colorScale    the user's scale for it, or null for the automatic one
 * @param sharedTicks   { tickvals, ticktext } for a shared axis whose values are
 *                      ranks rather than a quantity, or null
 * @param sharedText    one string per row naming where that row is, or null
 * @param size          { width, height }
 * @param uirevision    changes whenever the axis set changes
 * @param reversedYAxes the columns whose Y axis is drawn downwards
 */
export function buildFigure({
  plan,
  variablesByName,
  panels,
  sharedAxis,
  data,
  colors = {},
  labels = {},
  title = "",
  mode = "markers",
  colorAxis = null,
  colorScale = null,
  sharedTicks = null,
  sharedText = null,
  size = {},
  uirevision,
  reversedYAxes = new Set(plan.sharedReversed ? [sharedAxis] : []),
}) {
  const { titleFor, hoverLine } = labellerFor(variablesByName, labels);

  const arrangement = ARRANGEMENTS[plan.orientation] || ROWS_LAYOUT;
  const { shared: sharedLetter, panel: panelLetter } = arrangement;
  const domains = domainsFor(panels.length, arrangement.gap);

  const wrappedTitle = wrapTitleFor(title, size.width);
  const titleLines = wrappedTitle ? wrappedTitle.split("<br>").length : 0;

  // Decided here rather than taken on trust: a column with no numeric value in
  // it carries no ramp, and Plotly would ignore it in silence.
  const colorVariable = colorAxis ? variablesByName.get(colorAxis) : undefined;
  const colorDimension = colorDimensionFor(colorVariable, data);
  const hasColorBar = Boolean(colorDimension);
  const colorStops = hasColorBar
    ? colorScaleForVariable(colorVariable, colorScale)
    : null;
  // The ramp's line is drawn by traces of its own — see previewColoredLine.js —
  // leaving the panel's trace the markers and the hover.
  const coloredLine = hasColorBar && mode.includes("lines");

  // 0 until the plot area has been measured, and maxCharsFor turns that into
  // "leave the label alone". The width needs only the side margins, so it is
  // known before the top margin is.
  const sideMargin = marginFor(plan.orientation, titleLines);
  const plottingWidth = size.width
    ? Math.max(size.width - sideMargin.l - sideMargin.r, 0)
    : 0;
  // A panel title wraps across its own panel; on top, its lines are what the
  // top margin reserves, so they never climb into the figure title.
  const panelTitles = panels.map((columnName, index) =>
    panelLetter === "x"
      ? wrapLabel(
          titleFor(columnName),
          maxCharsFor(plottingWidth * (domains[index][1] - domains[index][0])),
        )
      : null,
  );
  const panelTitleLines = Math.max(
    1,
    ...panelTitles.map((text) => (text ? text.split("<br>").length : 1)),
  );
  const margin = marginFor(plan.orientation, titleLines, panelTitleLines);
  const plottingHeight = size.height
    ? Math.max(size.height - margin.t - margin.b, 0)
    : 0;
  // A title wraps against the length of its own axis: across for x, along for y.
  const wrapAlong = (text, letter, domain, maxLines) =>
    wrapLabel(
      text,
      maxCharsFor(
        (letter === "y" ? plottingHeight : plottingWidth) *
          (domain[1] - domain[0]),
      ),
      maxLines,
    );
  const binLimit = coloredLine
    ? lineBinLimitFor({
        panelCount: panels.length,
        axisPixels: sharedLetter === "y" ? plottingHeight : plottingWidth,
      })
    : 0;

  const layout = {
    uirevision,
    margin,
    // Ticks; every label states its own LABEL_FONT_PX.
    font: { size: TICK_FONT_PX },
    hoverlabel: { font: { size: HOVER_FONT_PX } },
    showlegend: false, // each panel is titled; a legend would repeat it
    // One hover for every panel at once, along the axis they share.
    // `hoversubplots` is what widens it past the panel under the pointer.
    hovermode: arrangement.hovermode,
    hoversubplots: "axis",
    dragmode: "zoom",
    modebar: { orientation: "v" },
    ...(size.width ? { width: size.width } : {}),
    ...(size.height ? { height: size.height } : {}),
  };

  if (titleLines) layout.title = layoutTitleFor(wrappedTitle);

  if (hasColorBar) {
    // ONE colour axis in the layout, not one mapping per trace: Plotly ranges it
    // across every trace that references it, so all the panels read against the
    // one scale by construction.
    //
    // The range is stated rather than left to Plotly, because the legend beside
    // the plot has to paint the same one.
    layout.coloraxis = {
      colorscale: colorStops,
      ...(colorDimension.range
        ? { cmin: colorDimension.range[0], cmax: colorDimension.range[1] }
        : {}),
      showscale: false, // drawn outside the figure — see ColorScaleLegend.jsx
    };
  }

  const sharedTitle = titleFor(sharedAxis);
  // A rank has no quantity to tick at: every label is named by the caller, and
  // Plotly's own round numbers would be positions nobody sampled.
  const tickOverride = sharedTicks
    ? {
        tickmode: "array",
        tickvals: sharedTicks.tickvals,
        ticktext: sharedTicks.ticktext,
      }
    : {};

  layout[`${sharedLetter}axis`] = {
    automargin: true,
    domain: [0, 1],
    anchor: panelLetter,
    ...sharedAxisSpike,
    ...tickOverride,
    ...(arrangement.unifiedHover
      ? {
          // The unified box's own title. Left alone it is the bare axis value;
          // this makes it read like the rows underneath it.
          unifiedhovertitle: {
            text: hoverLine(sharedAxis, `%{${sharedLetter}}`),
          },
        }
      : {}),
    ...(sharedLetter === "y" && reversedYAxes.has(sharedAxis)
      ? { autorange: "reversed" }
      : {}),
    title: axisTitle(
      wrapAlong(sharedTitle, sharedLetter, [0, 1], PINNED_AXIS_LINES), // the pinned strip's fixed room
    ),
  };

  const lineTraces = [];
  const traces = panels.map((columnName, index) => {
    const domain = domains[index];
    const panelTitle = titleFor(columnName);

    // In a stack, y domains count up from the bottom, so the first variable is
    // lowest.
    layout[axisKey(panelLetter, index)] = {
      domain,
      anchor: sharedLetter,
      automargin: true,
      ...(arrangement.panelTitleSide
        ? { side: arrangement.panelTitleSide }
        : {}),
      // Wrapped to its own panel's width, not the plot's.
      title: axisTitle(
        panelTitles[index] ?? wrapAlong(panelTitle, panelLetter, domain),
      ),
      zeroline: false,
      ...(panelLetter === "y" && reversedYAxes.has(columnName)
        ? { autorange: "reversed" }
        : {}),
    };

    const sharedValues = (data || []).map((row) => row[sharedAxis]);
    const panelValues = (data || []).map((row) => row[columnName]);
    // This colour says WHICH variable the panel draws — the colour DIMENSION,
    // when one is set, takes the markers and the line instead.
    const color =
      colors[columnName] ||
      defaultColorFor(variablesByName.get(columnName), index);

    // The colour column is worth a hover line unless the box already prints it.
    // A unified box gathers every panel from the SAME data row, so it gets the
    // line once, on the first panel, and none when any panel draws that column.
    const colorAlreadyPrinted = arrangement.unifiedHover
      ? panels.includes(colorAxis)
      : colorAxis === columnName;
    const colorInHover =
      hasColorBar &&
      colorAxis !== sharedAxis &&
      !colorAlreadyPrinted &&
      (!arrangement.unifiedHover || index === 0);

    // Where the row IS, when the shared axis only says which row it is. Carried
    // as `text` because customdata is spoken for by the colour dimension, and
    // kept out of a unified box for the same reason as the colour line.
    const positionInHover =
      !arrangement.unifiedHover && sharedText && sharedText.length;

    if (coloredLine) {
      coloredLineBinsFor({
        sharedValues,
        panelValues,
        colorValues: colorDimension.values,
        range: colorDimension.range,
        stops: colorStops,
        binLimit,
        fallbackColor: color,
      }).forEach((bin) =>
        lineTraces.push({
          type: "scatter",
          mode: "lines",
          hoverinfo: "skip", // the panel's own trace answers the hover
          [panelLetter]: bin.panelValues,
          [sharedLetter]: bin.sharedValues,
          [`${panelLetter}axis`]: axisRef(panelLetter, index),
          [`${sharedLetter}axis`]: sharedLetter,
          line: { color: bin.color },
        }),
      );
    }

    return {
      type: "scatter",
      mode: coloredLine ? "markers" : mode,
      // Never drawn — <extra></extra> drops the box Plotly keeps it in — but
      // plain rather than wrapped: a <br> belongs to the panel that needed it.
      name: panelTitle,
      // The letters are the arrangement's: the panel's own axis carries its
      // values, the shared one carries the axis every panel is drawn against.
      [panelLetter]: panelValues,
      [sharedLetter]: sharedValues,
      [`${panelLetter}axis`]: axisRef(panelLetter, index),
      [`${sharedLetter}axis`]: sharedLetter,
      hovertemplate:
        // One line in a unified box, where the shared axis is in the title
        // already; two in a box of its own, which has no title.
        (arrangement.unifiedHover
          ? hoverLine(columnName, `%{${panelLetter}}`)
          : positionInHover
            ? `${hoverLine(sharedAxis, `%{${sharedLetter}:d}`)}<br>%{text}<br>${hoverLine(columnName, `%{${panelLetter}}`)}` // ":d" prints the rank, not the lat/lon tick text %{text} already shows
            : `${hoverLine(sharedAxis, `%{${sharedLetter}}`)}<br>${hoverLine(columnName, `%{${panelLetter}}`)}`) +
        (colorInHover ? `<br>${hoverLine(colorAxis, "%{customdata}")}` : "") +
        "<extra></extra>",
      marker: hasColorBar
        ? {
            color: colorDimension.values,
            coloraxis: "coloraxis",
            ...(mode.includes("markers") ? {} : { opacity: 0 }), // kept for the hover
          }
        : { color },
      line: { color },
      ...(positionInHover ? { text: sharedText } : {}),
      ...(hasColorBar ? { customdata: colorDimension.hoverValues } : {}),
    };
  });

  // The same stops the markers were given and the same range they were mapped
  // over, so the strip above the plot and the markers cannot disagree about what
  // a colour means. Null when there is no colour column, which is what decides
  // whether the strip is rendered at all.
  const colorLegend = hasColorBar
    ? {
        label: titleFor(colorAxis),
        stops: colorStops,
        ticks: legendTicksFor(colorDimension),
      }
    : null;
  // First, so every panel's markers draw over its line.
  return { data: [...lineTraces, ...traces], layout, colorLegend };
}

const COLORBAR_THICKNESS_PX = 12;
const COLORBAR_PAD_PX = 10;

/**
 * The colour plot: every panel draws the same Y against the same X, one panel
 * per colour variable, each shaded by its own variable through its own
 * colourbar. The bar spans exactly its panel's domain, which is what ties a
 * scale to its graph.
 *
 * Takes buildFigure's inputs, except that `panels` are the colour variables and
 * `xAxis`/`yAxis` replace `sharedAxis`. Always stacked: the bars sit inside the
 * figure, and only a stack is guaranteed never to scroll them out of view.
 *
 * @param scales { [columnName]: scaleName } — the user's overrides only
 * @param yReversed draw Y downwards; by default when Y is a depth or a pressure
 */
export function buildColorFigure({
  variablesByName,
  panels,
  xAxis,
  yAxis,
  data,
  labels = {},
  scales = {},
  title = "",
  mode = "markers",
  sharedTicks = null,
  sharedText = null,
  size = {},
  uirevision,
  yReversed = isDownwardVertical(variablesByName.get(yAxis)),
}) {
  const { titleFor, hoverLine } = labellerFor(variablesByName, labels);
  const domains = domainsFor(panels.length, ROW_GAP);

  const wrappedTitle = wrapTitleFor(title, size.width);
  const titleLines = wrappedTitle ? wrappedTitle.split("<br>").length : 0;
  const baseMargin = marginFor(ROWS, titleLines);
  const margin = { ...baseMargin, r: baseMargin.r + COLORBAR_ROOM_PX };
  const plottingWidth = size.width
    ? Math.max(size.width - margin.l - margin.r, 0)
    : 0;
  const plottingHeight = size.height
    ? Math.max(size.height - margin.t - margin.b, 0)
    : 0;
  const wrapAlong = (text, pixels, maxLines) =>
    wrapLabel(text, maxCharsFor(pixels), maxLines);
  const binLimit = mode.includes("lines")
    ? lineBinLimitFor({ panelCount: panels.length, axisPixels: plottingWidth })
    : 0;

  const layout = {
    uirevision,
    margin,
    font: { size: TICK_FONT_PX },
    hoverlabel: { font: { size: HOVER_FONT_PX } },
    showlegend: false,
    // Panels share X and Y but not their rows' colours: the point under the
    // pointer is the only one worth a box.
    hovermode: "closest",
    dragmode: "zoom",
    modebar: { orientation: "v" },
    ...(size.width ? { width: size.width } : {}),
    ...(size.height ? { height: size.height } : {}),
  };
  if (titleLines) layout.title = layoutTitleFor(wrappedTitle);

  layout.xaxis = {
    automargin: true,
    domain: [0, 1],
    anchor: "y",
    ...(sharedTicks
      ? {
          tickmode: "array",
          tickvals: sharedTicks.tickvals,
          ticktext: sharedTicks.ticktext,
        }
      : {}),
    title: axisTitle(
      wrapAlong(titleFor(xAxis), plottingWidth, PINNED_AXIS_LINES), // the pinned strip's fixed room
    ),
  };

  const yTitle = titleFor(yAxis);
  const xValues = (data || []).map((row) => row[xAxis]);
  const yValues = (data || []).map((row) => row[yAxis]);

  const lineTraces = [];
  const traces = panels.map((columnName, index) => {
    const domain = domains[index];
    const variable = variablesByName.get(columnName);
    const dimension = colorDimensionFor(variable, data);
    const stops = colorScaleForVariable(variable, scales[columnName]);
    const colorAxisName = index === 0 ? "coloraxis" : `coloraxis${index + 1}`;
    const fallbackColor = defaultColorFor(variable, index);

    layout[axisKey("y", index)] = {
      domain,
      anchor: "x",
      automargin: true,
      zeroline: false,
      ...(index > 0 ? { matches: "y" } : {}), // one zoom for every panel
      ...(yReversed ? { autorange: "reversed" } : {}),
      title: axisTitle(
        wrapAlong(yTitle, plottingHeight * (domain[1] - domain[0])),
      ),
    };

    if (dimension) {
      layout[colorAxisName] = {
        colorscale: stops,
        ...(dimension.range
          ? { cmin: dimension.range[0], cmax: dimension.range[1] }
          : {}),
        colorbar: {
          x: 1,
          xanchor: "left",
          xpad: COLORBAR_PAD_PX,
          y: (domain[0] + domain[1]) / 2,
          yanchor: "middle",
          len: domain[1] - domain[0],
          lenmode: "fraction",
          thickness: COLORBAR_THICKNESS_PX,
          tickfont: { size: TICK_FONT_PX },
          ...(dimension.ticks || {}),
          title: {
            // Along its own bar, like the panel's Y title: unwrapped, a long
            // name runs past the bar into its neighbours'.
            text: wrapAlong(
              titleFor(columnName),
              plottingHeight * (domain[1] - domain[0]),
            ),
            side: "right",
            font: { size: LABEL_FONT_PX },
          },
        },
      };
    }

    // A row with no colour has nothing to say on this panel: a gap, not a grey
    // point.
    const panelY = dimension
      ? yValues.map((value, row) =>
          dimension.values[row] === null ? null : value,
        )
      : yValues;

    if (dimension && mode.includes("lines")) {
      coloredLineBinsFor({
        sharedValues: xValues,
        panelValues: panelY,
        colorValues: dimension.values,
        range: dimension.range,
        stops,
        binLimit,
        fallbackColor,
      }).forEach((bin) =>
        lineTraces.push({
          type: "scatter",
          mode: "lines",
          hoverinfo: "skip",
          x: bin.sharedValues,
          y: bin.panelValues,
          xaxis: "x",
          yaxis: axisRef("y", index),
          line: { color: bin.color },
        }),
      );
    }

    const positionLine = sharedText
      ? `${hoverLine(xAxis, "%{x:d}")}<br>%{text}` // ":d" prints the rank
      : hoverLine(xAxis, "%{x}");
    return {
      type: "scatter",
      mode: dimension && mode.includes("lines") ? "markers" : mode,
      name: titleFor(columnName),
      x: xValues,
      y: panelY,
      xaxis: "x",
      yaxis: axisRef("y", index),
      hovertemplate: `${positionLine}<br>${hoverLine(yAxis, "%{y}")}<br>${hoverLine(columnName, "%{customdata}")}<extra></extra>`,
      marker: dimension
        ? {
            color: dimension.values,
            coloraxis: colorAxisName,
            ...(mode.includes("markers") ? {} : { opacity: 0 }), // kept for the hover
          }
        : { color: fallbackColor },
      line: { color: fallbackColor },
      customdata: dimension
        ? dimension.hoverValues
        : (data || []).map((row) => row[columnName]),
      ...(sharedText ? { text: sharedText } : {}),
    };
  });

  return { data: [...lineTraces, ...traces], layout, colorLegend: null };
}
