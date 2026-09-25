// The Plotly figure for a faceted record preview: one panel per selected
// variable, all sharing one axis.
//
// WHY EXPLICIT AXIS DOMAINS AND NOT layout.grid
// plotly.js-basic-dist-min bundles the grid component, but resolves a grid into
// axis domains inside supplyLayoutDefaults — i.e. only against a real DOM. Doing
// the arithmetic here (see previewFacetSizing) makes this function's return
// value the thing under test, assertable under `node --test` with no browser.
//
// WHY SOME LABELS ARE ANNOTATIONS AND NOT AXIS TITLES
// A cartesian axis title in this Plotly is exactly {text, font, standoff} —
// there is no angle on it, so Plotly always writes a y axis title sideways.
// Every label here has to read horizontally, so the two that would sit beside a
// vertical axis are drawn as layout.annotations instead: the shared depth label
// in a profile, and each panel's label in a stack. The labels Plotly already
// draws horizontally stay axis titles, because axis titles get `automargin` and
// annotations do not.

import { COLUMNS, ROWS } from "./previewFacetPlan.js";
import { labelFor, shortLabelFor } from "./previewVariables.js";
import { defaultColorFor } from "./previewColors.js";
import {
  colorDimensionFor,
  colorScaleForVariable,
  legendTicksFor,
} from "./previewColorScales.js";
import {
  ellipsize,
  maxCharsFor,
  titleLinesFor,
  wrapLabel,
  wrapTitleFor,
  LABEL_FONT_PX,
  TITLE_FONT_PX,
} from "./previewLabelText.js";
import {
  boxBudgetFor,
  domainsFor,
  heightBudgetFor,
  marginFor,
  plotHeightFor,
  plotWidthFor,
  COLUMN_GAP,
  LABEL_GUTTER_PX,
  ROW_GAP,
  TICK_ROOM_PX,
  TITLE_PAD_PX,
} from "./previewFacetSizing.js";

// How much of a name a hover row may spend. Long enough for "Practical
// Salinity", short enough that six rows stay a box rather than a paragraph.
const HOVER_NAME_CHARS = 22;

const axisKey = (letter, index) =>
  index === 0 ? `${letter}axis` : `${letter}axis${index + 1}`;
const axisRef = (letter, index) =>
  index === 0 ? letter : `${letter}${index + 1}`;

// A vertical axis's own label, in the place Plotly would have put its title —
// beside the axis, centred on the span it labels — but horizontal instead of
// rotated. `y` is the centre of that span in paper coordinates.
const axisLabel = (text, y) => ({
  text,
  xref: "paper",
  x: 0,
  xanchor: "right",
  xshift: -TICK_ROOM_PX,
  yref: "paper",
  y,
  yanchor: "middle",
  showarrow: false,
  align: "right",
  font: { size: LABEL_FONT_PX },
});

// Vertical-axis labels wrap into the fixed gutter the margin reserves, not into
// a measured panel — the gutter is a constant, so these wrap on the very first
// render too. Four lines because the panel is at least MIN_PANEL_PX tall.
const wrapAxisLabel = (text) =>
  wrapLabel(text, maxCharsFor(LABEL_GUTTER_PX), 4);

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
// traces — the gap between panels, how the hover is gathered, and which of its
// two labels can be an axis title at all.
//
// `annotated` is the one that needs saying: a label beside a VERTICAL axis
// cannot be an axis title, because this Plotly writes those sideways and offers
// no angle anywhere. A profile's shared depth label is therefore an annotation
// while each panel is titled on top; a stack is exactly the reverse.
const COLUMNS_LAYOUT = {
  gap: COLUMN_GAP,
  shared: "y",
  panel: "x",
  hovermode: "y unified",
  // Plotly rotates every hover box by a fixed 60° when hovermode is "y" and
  // more than one is drawn — YANGLE, and no attribute turns it off. Unified
  // gathers them into one horizontal box instead.
  unifiedHover: true,
  annotated: "shared",
  panelTitleSide: "top",
};

const ROWS_LAYOUT = {
  gap: ROW_GAP,
  shared: "x",
  panel: "y",
  // Not rotated, so a stack keeps one box per panel.
  hovermode: "x",
  unifiedHover: false,
  annotated: "panel",
  panelTitleSide: null,
};

const ARRANGEMENTS = { [COLUMNS]: COLUMNS_LAYOUT, [ROWS]: ROWS_LAYOUT };

const TITLE_JOIN = " — ";
const VALUE_JOIN = ", ";
// A record window can legitimately span more than one profile; naming all of
// them would be a paragraph, so three and a count.
const MAX_TITLE_VALUES = 3;

// Every value the column actually takes over these rows, first seen first,
// blanks and ERDDAP's own empty spellings dropped.
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

/**
 * What names the record on screen: one entry per cf_role column, in ERDDAP's
 * order, as "<its label>: <its value>".
 *
 * For a TimeSeriesProfile the record id is the STATION while the thing drawn is
 * one PROFILE, which nothing else on screen names. A column present but empty is
 * skipped rather than printed as a bare "Profile: ".
 */
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
}) {
  const title = recordTitleFor({ plan, variablesByName, data });
  const width = plotWidthFor(
    plan.orientation,
    panelCount,
    boxBudgetFor(measured.width),
  );
  const titleLines = titleLinesFor(title, width);
  const height = plotHeightFor(
    plan.orientation,
    panelCount,
    heightBudgetFor(availableHeight, measured.height),
    titleLines,
  );
  return { title, width, height, titleLines };
}

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
}) {
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

  const arrangement = ARRANGEMENTS[plan.orientation] || ROWS_LAYOUT;
  const { shared: sharedLetter, panel: panelLetter } = arrangement;
  const domains = domainsFor(panels.length, arrangement.gap);

  // Only the lines the title actually needs are paid for, which is why the wrap
  // happens before the margin is chosen.
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
  // A ramp has nothing to draw on without markers.
  const drawMode = hasColorBar && mode === "lines" ? "markers+lines" : mode;

  const margin = marginFor(plan.orientation, titleLines);
  // 0 until the plot area has been measured, and maxCharsFor turns that into
  // "leave the label alone".
  const plottingWidth = size.width
    ? Math.max(size.width - margin.l - margin.r, 0)
    : 0;
  const wrapAt = (text, widthPx) => wrapLabel(text, maxCharsFor(widthPx));

  const annotations = [];
  const layout = {
    uirevision,
    margin,
    // Stated rather than inherited, because maxCharsFor's estimate assumes it.
    font: { size: LABEL_FONT_PX },
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

  if (titleLines) {
    // Pinned inside the top margin: yref 'container' with y 1 and yanchor 'top'
    // puts the first line's cap top exactly pad.t below the top of the image.
    //
    // title.automargin is deliberately NOT set. It exists in this bundle and it
    // only ever grows a margin — but it grows it inside a height that is fixed
    // here, so a push nobody predicted would silently shrink every panel below
    // the MIN_PANEL_PX the floor promised. Reserved by hand instead.
    layout.title = {
      text: wrappedTitle,
      font: { size: TITLE_FONT_PX },
      xref: "container",
      x: 0.5,
      xanchor: "center",
      yref: "container",
      y: 1,
      yanchor: "top",
      pad: { t: TITLE_PAD_PX },
    };
  }

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

  const sharedIsAnnotated = arrangement.annotated === "shared";
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
    ...(plan.sharedReversed ? { autorange: "reversed" } : {}),
    // Horizontal here, so it keeps an axis title and automargin sizes for it.
    ...(sharedIsAnnotated
      ? {}
      : { title: axisTitle(wrapAt(sharedTitle, plottingWidth)) }),
  };
  if (sharedIsAnnotated) {
    annotations.push(axisLabel(wrapAxisLabel(sharedTitle), 0.5));
  }

  const traces = panels.map((columnName, index) => {
    const domain = domains[index];
    const panelTitle = titleFor(columnName);

    // domainsFor counts up from 0, and 0 is the BOTTOM of a Plotly y axis, so a
    // stack's panel order already puts the first selected variable lowest.
    const panelIsAnnotated = arrangement.annotated === "panel";
    layout[axisKey(panelLetter, index)] = {
      domain,
      anchor: sharedLetter,
      automargin: true,
      ...(arrangement.panelTitleSide
        ? { side: arrangement.panelTitleSide }
        : {}),
      ...(panelIsAnnotated
        ? {}
        : {
            // Wrapped to its OWN panel's width: six panels in a 1140px modal
            // are ~170px each, and one unwrapped long_name covers three.
            title: axisTitle(
              wrapAt(panelTitle, plottingWidth * (domain[1] - domain[0])),
            ),
          }),
      zeroline: false,
    };
    if (panelIsAnnotated) {
      annotations.push(
        axisLabel(wrapAxisLabel(panelTitle), (domain[0] + domain[1]) / 2),
      );
    }

    const sharedValues = (data || []).map((row) => row[sharedAxis]);
    const panelValues = (data || []).map((row) => row[columnName]);
    // This colour says WHICH variable the panel draws — the colour DIMENSION,
    // when one is set, takes the markers and says what a third column was doing,
    // leaving this on the line.
    const color =
      colors[columnName] ||
      defaultColorFor(variablesByName.get(columnName), index);

    // The colour column is worth a hover line unless this panel already prints
    // it. Never in a unified box: every row of it comes from the SAME data row,
    // so one line per panel would be one copy of the same value per panel.
    const colorInHover =
      !arrangement.unifiedHover &&
      hasColorBar &&
      colorAxis !== sharedAxis &&
      colorAxis !== columnName;

    // Where the row IS, when the shared axis only says which row it is. Carried
    // as `text` because customdata is spoken for by the colour dimension, and
    // kept out of a unified box for the same reason as the colour line.
    const positionInHover =
      !arrangement.unifiedHover && sharedText && sharedText.length;

    return {
      type: "scatter",
      mode: drawMode,
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
          : `${hoverLine(sharedAxis, `%{${sharedLetter}}`)}${positionInHover ? "<br>%{text}" : ""}<br>${hoverLine(columnName, `%{${panelLetter}}`)}`) +
        (colorInHover ? `<br>${hoverLine(colorAxis, "%{customdata}")}` : "") +
        "<extra></extra>",
      marker: hasColorBar
        ? { color: colorDimension.values, coloraxis: "coloraxis" }
        : { color },
      line: { color },
      ...(positionInHover ? { text: sharedText } : {}),
      ...(hasColorBar ? { customdata: colorDimension.hoverValues } : {}),
    };
  });

  layout.annotations = annotations;
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
  return { data: traces, layout, colorLegend };
}
