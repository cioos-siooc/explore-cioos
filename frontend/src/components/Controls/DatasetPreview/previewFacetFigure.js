// The Plotly figure for a faceted record preview: one panel per selected
// variable, all sharing one axis.
//
// WHY EXPLICIT AXIS DOMAINS AND NOT layout.grid
// plotly.js-basic-dist-min 3.7.0 does bundle the grid component (pattern,
// roworder, xside, yside are all in the schema), but it resolves a grid into
// axis domains inside supplyLayoutDefaults — i.e. only against a real DOM. Doing
// the domain arithmetic here instead makes this function's return value the
// thing under test, so the whole layout is assertable under `node --test` in an
// environment with no browser. It is also the same shape the previous
// two-variable plot already used, just generalised from 2 axes to N.
//
// Axis wiring:
//   COLUMNS (profiles)  one shared `yaxis`, N x axes each with its own domain,
//                       all anchored to y. Traces: {xaxis:'x<i>', yaxis:'y'}.
//   ROWS (timeseries)   one shared `xaxis`, N y axes each with its own domain,
//                       all anchored to x. Traces: {xaxis:'x', yaxis:'y<i>'}.
//
// WHY SOME LABELS ARE ANNOTATIONS AND NOT AXIS TITLES
// A cartesian axis title in this Plotly is exactly {text, font, standoff} —
// there is no angle anywhere on it, so Plotly always writes a y axis title
// sideways. Every label here has to read horizontally, so the two labels that
// would sit beside a vertical axis are drawn as layout.annotations instead:
// the shared depth label in a profile, and each panel's label in a stack. The
// labels that Plotly already draws horizontally (a profile's panel titles on
// top, a stack's shared axis at the bottom) stay axis titles, because axis
// titles get `automargin` and annotations do not.
//
// WHY THERE IS A FIGURE TITLE AGAIN
// The modal header reads "<dataset title>: <record id>", so the figure went
// without one. But the header is not part of the figure — a downloaded PNG
// carries the title and nothing else — and for a TimeSeriesProfile the record id
// is the STATION while the thing drawn is one PROFILE, which nothing on screen
// named. The title says what the cf_role columns say: see recordTitleFor.

import { COLUMNS } from "./previewFacetPlan.js";
import { labelFor, shortLabelFor } from "./previewVariables.js";
import { defaultColorFor } from "./previewColors.js";
import {
  colorDimensionFor,
  colorScaleForVariable,
} from "./previewColorScales.js";

// Left of every vertical axis: room for its tick labels, then room for the
// axis's own label, which is written horizontally and so needs width where a
// rotated one needed almost none. Both are reserved on the left in both
// orientations, because both put a labelled vertical axis there — the shared
// depth axis of a profile, and every panel's axis in a stack.
const TICK_ROOM_PX = 52;
export const LABEL_GUTTER_PX = 104;

// Room for the shared axis, its labels, and the modebar — before the figure
// title, which marginFor() adds on top. Orientation-dependent because the two
// layouts spend their other edges differently: a profile puts its panel titles
// on TOP and nothing at the bottom, a stack puts its shared axis at the BOTTOM.
const COLUMNS_MARGIN = {
  l: TICK_ROOM_PX + LABEL_GUTTER_PX,
  r: 26,
  t: 54,
  b: 22,
};
const ROWS_MARGIN = { l: TICK_ROOM_PX + LABEL_GUTTER_PX, r: 26, t: 30, b: 62 };

// One colourbar's worth of right margin: the gap Plotly leaves on BOTH sides of
// the strip, the strip, and room for its tick labels — the same room the left
// axis reserves for its own, because they label the same kind of number.
//
// It has to match what Plotly asks for, because a colourbar calls autoMargin:
// reserve less and it grows the margin inside a width fixed here, taking the
// difference out of the panels. Reserving exactly its request means it asks for
// nothing. That holds until a tick label runs past TICK_ROOM_PX, which is a few
// pixels off the panels rather than a broken layout.
const COLORBAR_PAD_PX = 10; // Plotly's own xpad default
const COLORBAR_THICKNESS_PX = 14;
export const COLORBAR_GUTTER_PX =
  2 * COLORBAR_PAD_PX + COLORBAR_THICKNESS_PX + TICK_ROOM_PX;
// The bar hangs from the top and its label goes underneath, not above: the
// modebar is vertical and lives in the top right corner, so a label up there
// would be drawn under it every time the pointer entered the figure.
const COLORBAR_LEN = 0.82;
const COLORBAR_LABEL_GAP = 0.02;

// The title is bigger than a label (12) because it is a title, and its room is
// reserved by hand for the same reason the annotations' is: see marginFor.
export const TITLE_FONT_PX = 14;
// 14px at Plotly's LINE_SPACING of 1.3 is 18.2; 19 buys a pixel of clearance
// rather than spending one.
const TITLE_LINE_PX = 19;
const TITLE_PAD_PX = 10;
export const MAX_TITLE_LINES = 2;

// Top margin a title of `lineCount` lines needs, or nothing at all when there
// is no title — a record whose columns carry no cf_role value must not pay for
// one.
export function titleRoomFor(lineCount) {
  return lineCount > 0 ? TITLE_PAD_PX + lineCount * TITLE_LINE_PX : 0;
}

/**
 * The margins the layout uses. `titleLines` defaults to the worst case, so the
 * sizing floors below reserve room for a title they cannot measure; buildFigure
 * passes the count it actually wrapped to. `hasColorBar` defaults to off, so
 * every caller that knows nothing about the colour dimension keeps the margins
 * it always had.
 */
export function marginFor(
  orientation,
  titleLines = MAX_TITLE_LINES,
  hasColorBar = false,
) {
  const base = orientation === COLUMNS ? COLUMNS_MARGIN : ROWS_MARGIN;
  return {
    ...base,
    r: base.r + (hasColorBar ? COLORBAR_GUTTER_PX : 0),
    t: base.t + titleRoomFor(titleLines),
  };
}

// Gap between panels, as a fraction of ONE PANEL rather than of the whole
// plotting area — which is what it used to be, and it does not survive many
// panels: at 5.5 % each, nineteen panels spend 99 % of the width on the
// eighteen gaps between them and every panel comes out about a pixel wide. A
// panel-relative gap keeps the same proportions at any n.
//
// 0.22 is also what makes six 150 px profile panels fit a ~1140 px modal
// exactly, with 33 px between them. Stacked panels need much less: every panel
// is labelled beside its own axis, and only the bottom one carries x tick
// labels, so the gap is separation and nothing else — and vertical space is the
// scarce one, since that is the direction the modal scrolls.
const COLUMN_GAP = 0.22;
const ROW_GAP = 0.12;
// Below this a panel is not worth drawing; the container scrolls instead.
export const MIN_PANEL_PX = 150;
export const MIN_PLOT_PX = 320;

// Every label is drawn at this size explicitly, rather than at Plotly's default
// for an axis title — which is bigFont(layout.font.size) = round(1.2 * 12) = 14.
// Being explicit is what lets maxCharsFor() below predict how wide a label will
// actually render, and 12 matches the tick labels.
export const LABEL_FONT_PX = 12;
// Average advance per character for Plotly's default stack ("Open Sans, verdana,
// arial, sans-serif"), as a fraction of the font size. Deliberately generous:
// overestimating the width wraps a label one word early, underestimating it puts
// two panel titles on top of each other, which is the bug this is fixing.
const CHAR_PX_PER_FONT_PX = 0.58;
const MAX_LABEL_LINES = 3;

// How many characters fit in `widthPx`. 0 means "unknown" — buildFigure is
// called before the plot area has been measured, and every caller treats 0 as
// "do not wrap" rather than wrapping against a guessed width.
export function maxCharsFor(widthPx, fontPx = LABEL_FONT_PX) {
  if (!widthPx || widthPx <= 0) return 0;
  return Math.max(8, Math.floor(widthPx / (fontPx * CHAR_PX_PER_FONT_PX)));
}

// labelFor() writes "long_name ( unit )", and the unit group is both the tail of
// every label and the part that collides first, so it gets its own line.
const UNIT_SUFFIX = /\s\(\s[^()]*\s\)$/;

function greedyLines(text, maxChars) {
  const lines = [];
  let current = "";
  text
    .split(/\s+/)
    .filter(Boolean)
    .forEach((word) => {
      if (!current) {
        current = word;
      } else if (`${current} ${word}`.length <= maxChars) {
        current = `${current} ${word}`;
      } else {
        lines.push(current);
        current = word;
      }
    });
  if (current) lines.push(current);
  return lines;
}

function ellipsize(text, maxChars) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

/**
 * Break a label onto as many lines as it needs, with <br> — which is what Plotly
 * reads inside a title or an annotation, and what it counts when it grows a
 * margin to fit one.
 *
 * A word is never split: a single long token overflows its panel slightly rather
 * than being mangled. Past `maxLines` the NAME is truncated and the unit line is
 * always kept — a label whose unit went missing reads as a different quantity.
 */
export function wrapLabel(text, maxChars, maxLines = MAX_LABEL_LINES) {
  const label = (text || "").trim();
  if (!maxChars || label.length <= maxChars) return label;

  const match = label.match(UNIT_SUFFIX);
  const unit = match ? match[0].trim() : "";
  const name = match ? label.slice(0, match.index).trim() : label;

  const allowed = Math.max(1, maxLines - (unit ? 1 : 0));
  let lines = greedyLines(name, maxChars);
  if (!lines.length) lines = [""];
  if (lines.length > allowed) {
    const kept = lines.slice(0, allowed - 1);
    kept.push(ellipsize(lines.slice(allowed - 1).join(" "), maxChars));
    lines = kept;
  }
  return [...lines, ...(unit ? [unit] : [])].join("<br>");
}

// The title wraps against the whole figure width, not a panel: it is centred on
// the figure, not on anything inside it.
export function wrapTitleFor(title, widthPx) {
  return wrapLabel(title, maxCharsFor(widthPx, TITLE_FONT_PX), MAX_TITLE_LINES);
}

// How many lines that wrap produced — what titleRoomFor() needs, and what the
// component needs before it can pick a height.
export function titleLinesFor(title, widthPx) {
  const wrapped = wrapTitleFor(title, widthPx);
  return wrapped ? wrapped.split("<br>").length : 0;
}

// The plotting area a panel count needs, in panels: n panels plus the gaps
// between them, each gap being `gapRatio` of a panel. Both the domains below and
// the minimum-size floors are derived from it, so they cannot drift apart —
// which is how the floors used to promise a 150 px panel and hand over a 109 px
// one.
export function panelPitch(n, gapRatio) {
  return n <= 0 ? 0 : n + (n - 1) * gapRatio;
}

// n evenly spaced [start, end] pairs over 0..1, separated by `gapRatio` of a
// panel.
export function domainsFor(n, gapRatio) {
  if (n <= 0) return [];
  if (n === 1) return [[0, 1]];
  const span = 1 / panelPitch(n, gapRatio);
  const pitch = span * (1 + gapRatio);
  const domains = Array.from({ length: n }, (_, index) => {
    const start = index * pitch;
    // Round to kill float drift, which Plotly reports as an invalid domain when
    // the last end lands at 1.0000000000000002.
    return [Number(start.toFixed(6)), Number((start + span).toFixed(6))];
  });
  // The ends are exact by construction and inexact in floating point; Plotly
  // wants the full 0..1 covered, so say so rather than hope the rounding agreed.
  domains[0][0] = 0;
  domains[n - 1][1] = 1;
  return domains;
}

// clientWidth/clientHeight are integers, rounded from a box that is fractional
// whenever `calc(100vh - 32px)` is — so the size reported can be half a pixel
// MORE than the box that has to hold the figure. In a scroll container that half
// pixel is a stub scrollbar on one axis, which then takes ~15px from the other,
// and both stay. Spending one pixel less than we were told makes a figure that
// fits strictly smaller than its box, so it never grows a scrollbar at all.
const SUBPIXEL_PX = 1;

export function boxBudgetFor(measuredPx) {
  return Math.max(Math.floor(measuredPx || 0) - SUBPIXEL_PX, 0);
}

// The height the figure may take. `paneHeight` is the same box as
// `availableHeight` less whatever a horizontal scrollbar took — nothing on
// overlay-scrollbar platforms, ~15px with classic ones — which is why it is
// measured rather than guessed at a constant that would be wrong on one of them.
//
// The min() is what makes it safe to measure the plot's OWN pane here, against
// the rule in useElementSize: the budget can only ever come down, so no CSS
// arrangement lets a taller figure buy itself more room. 0 means "not measured
// yet" (first render), where the scroller is the only thing to go on.
export function heightBudgetFor(availableHeight, paneHeight) {
  const available = Math.max(availableHeight || 0, 0);
  return boxBudgetFor(
    paneHeight > 0 ? Math.min(paneHeight, available) : available,
  );
}

// How tall the plot has to be. Constant in n for profiles, because the panels
// sit side by side and share one depth axis; growing for stacked panels, which
// is the case where "as many variables as the dataset has" and "no overflow"
// genuinely conflict.
export function plotHeightFor(
  orientation,
  panelCount,
  availableHeight,
  titleLines = MAX_TITLE_LINES,
) {
  const available = Math.max(availableHeight || 0, MIN_PLOT_PX);
  if (orientation === COLUMNS) return available;
  const margin = marginFor(orientation, titleLines);
  const needed =
    MIN_PANEL_PX * panelPitch(panelCount, ROW_GAP) + margin.t + margin.b;
  // Whole pixels: a fractional height is a fractional scroll position.
  return Math.ceil(Math.max(available, needed));
}

// Profiles get narrow fast: six panels in a 1140 px modal is ~170 px each, which
// still reads, but the floor is what keeps a 14-column selection legible at the
// cost of a horizontal scroll.
export function plotWidthFor(
  orientation,
  panelCount,
  availableWidth,
  hasColorBar = false,
) {
  const available = Math.max(availableWidth || 0, MIN_PLOT_PX);
  if (orientation !== COLUMNS) return available;
  const margin = marginFor(orientation, MAX_TITLE_LINES, hasColorBar);
  const needed =
    MIN_PANEL_PX * panelPitch(panelCount, COLUMN_GAP) + margin.l + margin.r;
  return Math.ceil(Math.max(available, needed));
}

const axisKey = (letter, index) =>
  index === 0 ? `${letter}axis` : `${letter}axis${index + 1}`;
const axisRef = (letter, index) =>
  index === 0 ? letter : `${letter}${index + 1}`;

// A vertical axis's own label, in the place Plotly would have put its title —
// beside the axis, centred on the span it labels — but written horizontally
// instead of rotated. `y` is the centre of that span in paper coordinates.
//
// Right-anchored and shifted clear of the tick labels, so the text sits flush
// against the axis and multi-line labels line up with each other.
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
// render too. Four lines because the panel is at least MIN_PANEL_PX tall and
// four lines of 12px are 68 of those 150 pixels.
const wrapAxisLabel = (text) =>
  wrapLabel(text, maxCharsFor(LABEL_GUTTER_PX), 4);

// The bar itself. Identical in both orientations: the panels span the whole
// plotting height either way, so there is nothing orientation-specific to say.
//
// NO title: a vertical colourbar's title is measured INTO the bar's own
// thickness, so a long one pushes the right margin past what marginFor reserved
// and takes the width back out of the panels — the same trap layout.title's
// automargin is left off for. The label is an annotation instead, below.
const colorBarFor = (ticks) => ({
  // paper x 1 is the right edge of the plotting area, i.e. the inside edge of
  // the margin marginFor() widened; xpad is the gap from there to the strip.
  x: 1,
  xanchor: "left",
  xpad: COLORBAR_PAD_PX,
  thicknessmode: "pixels",
  thickness: COLORBAR_THICKNESS_PX,
  lenmode: "fraction",
  len: COLORBAR_LEN,
  y: 1,
  yanchor: "top",
  // Nothing is drawn outside the thickness the margin was sized from.
  outlinewidth: 0,
  // Stated rather than inherited, like every other label here.
  tickfont: { size: LABEL_FONT_PX },
  // A colour axis over time carries epoch milliseconds, which nobody can read;
  // these are the four timestamps that stand in for them.
  ...(ticks || {}),
});

// Under the bar, horizontal, in the gutter the margin reserves — the mirror of
// axisLabel() on the other side of the figure.
const colorBarLabel = (text) => ({
  text,
  xref: "paper",
  x: 1,
  xanchor: "left",
  xshift: COLORBAR_PAD_PX,
  yref: "paper",
  y: 1 - COLORBAR_LEN - COLORBAR_LABEL_GAP,
  yanchor: "top",
  showarrow: false,
  align: "left",
  font: { size: LABEL_FONT_PX },
});

// Two lines, not the four a left-hand axis label gets: what is left under the
// bar is 16% of the plotting height, which at the MIN_PLOT_PX floor is ~36px.
const wrapColorBarLabel = (text) =>
  wrapLabel(text, maxCharsFor(LABEL_GUTTER_PX), 2);

// Between two id entries in the title, and between several values of one id.
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
 * On the Viking record that reads "Station Id: PMZA-RIKI — Profile:
 * PMZA-RIKI-25/09/16-17:35:26" — and the second half is the point, because the
 * station is what the user clicked and the profile is what is drawn. A column
 * present but empty is skipped rather than printed as a bare "Profile: ".
 *
 * shortLabelFor, not the figure's own titleFor: an id takes no unit and has no
 * rename field, so there is nothing for either to add.
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

  const isColumns = plan.orientation === COLUMNS;
  const gap = isColumns ? COLUMN_GAP : ROW_GAP;
  const domains = domainsFor(panels.length, gap);

  // Only the lines the title actually needs are paid for, which is why the wrap
  // happens before the margin is chosen.
  const wrappedTitle = wrapTitleFor(title, size.width);
  const titleLines = wrappedTitle ? wrappedTitle.split("<br>").length : 0;

  // The third dimension, when there is one. Decided here rather than taken on
  // trust: a column with no numeric value in it carries no ramp, and Plotly
  // would ignore it in silence. The caller's plotWidthFor may then have reserved
  // the bar's gutter for nothing — 86px of margin in the one case where the
  // panel floor is what set the width, which costs a gap and not a layout.
  const colorVariable = colorAxis ? variablesByName.get(colorAxis) : undefined;
  const colorDimension = colorDimensionFor(colorVariable, data);
  const hasColorBar = Boolean(colorDimension);
  const colorTitle = hasColorBar ? titleFor(colorAxis) : "";
  // A ramp has nothing to draw on without markers.
  const drawMode = hasColorBar && mode === "lines" ? "markers+lines" : mode;

  const margin = marginFor(plan.orientation, titleLines, hasColorBar);
  // The width labels actually have to fit in. 0 until the plot area has been
  // measured, and maxCharsFor turns that into "leave the label alone".
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
    hovermode: "closest",
    dragmode: "zoom",
    modebar: { orientation: "v" },
    ...(size.width ? { width: size.width } : {}),
    ...(size.height ? { height: size.height } : {}),
  };

  if (titleLines) {
    // Pinned inside the top margin: yref 'container' with y 1 and yanchor 'top'
    // puts the first line's cap top exactly pad.t below the top of the image, so
    // a profile's panel titles still have the rest of the margin to themselves.
    //
    // title.automargin is deliberately NOT set. It exists in this bundle and it
    // only ever grows a margin — but it grows it inside a height that is fixed
    // here, so a push nobody predicted would silently shrink every panel below
    // the MIN_PANEL_PX the floor promised. Reserved by hand instead, the same
    // way the annotations are.
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
    // one bar by construction rather than by every trace happening to carry the
    // same values. It is also what keeps cmin/cmax out of the traces entirely.
    layout.coloraxis = {
      colorscale: colorScaleForVariable(colorVariable, colorScale),
      showscale: true,
      colorbar: colorBarFor(colorDimension.ticks),
    };
  }

  const sharedTitle = titleFor(sharedAxis);

  if (isColumns) {
    // One depth axis on the left, spanning the full height. Its label cannot be
    // an axis title without being rotated, so it is an annotation beside the
    // axis instead — same place, centred on the same span, just horizontal.
    layout.yaxis = {
      automargin: true,
      domain: [0, 1],
      anchor: "x",
      ...(plan.sharedReversed ? { autorange: "reversed" } : {}),
    };
    annotations.push(axisLabel(wrapAxisLabel(sharedTitle), 0.5));
  } else {
    // Already horizontal: keep it an axis title and let automargin size for it.
    layout.xaxis = {
      automargin: true,
      domain: [0, 1],
      anchor: "y",
      title: {
        text: wrapAt(sharedTitle, plottingWidth),
        font: { size: LABEL_FONT_PX },
        standoff: 6,
      },
    };
  }

  const traces = panels.map((columnName, index) => {
    const domain = domains[index];
    const panelTitle = titleFor(columnName);

    if (isColumns) {
      layout[axisKey("x", index)] = {
        domain,
        anchor: "y",
        automargin: true,
        side: "top", // the image titles each profile panel above it
        title: {
          // Wrapped to its OWN panel's width: six panels in a 1140 px modal are
          // ~170 px each, and one unwrapped long_name covers three of them.
          text: wrapAt(panelTitle, plottingWidth * (domain[1] - domain[0])),
          font: { size: LABEL_FONT_PX },
          standoff: 6,
        },
        zeroline: false,
      };
    } else {
      // domainsFor counts up from 0, and 0 is the BOTTOM of a Plotly y axis, so
      // panel order already puts the first selected variable lowest — which is
      // how the image stacks them.
      layout[axisKey("y", index)] = {
        domain,
        anchor: "x",
        automargin: true,
        zeroline: false,
      };
      // No title on the axis: it would be rotated. An annotation beside the
      // axis instead, centred on this panel — where the axis title would have
      // been, only horizontal.
      annotations.push(
        axisLabel(wrapAxisLabel(panelTitle), (domain[0] + domain[1]) / 2),
      );
    }

    const sharedValues = (data || []).map((row) => row[sharedAxis]);
    const panelValues = (data || []).map((row) => row[columnName]);
    // The user's pick, else what the dataset's own colorBarPalette implies, else
    // the next colour along. This colour says WHICH variable the panel draws —
    // the colour DIMENSION, when one is set, takes the markers and says what a
    // third column was doing, leaving this on the line.
    const color =
      colors[columnName] ||
      defaultColorFor(variablesByName.get(columnName), index);

    // The colour column is worth a hover line unless this panel already prints
    // it — colouring by the shared axis, or by the variable drawn here, would
    // otherwise say the same number twice.
    const colorInHover =
      hasColorBar && colorAxis !== sharedAxis && colorAxis !== columnName;

    return {
      type: "scatter",
      mode: drawMode,
      // Plain, never the wrapped text: a <br> in a hover box breaks the line
      // where the panel needed it, not where the sentence does.
      name: panelTitle,
      x: isColumns ? panelValues : sharedValues,
      y: isColumns ? sharedValues : panelValues,
      xaxis: isColumns ? axisRef("x", index) : "x",
      yaxis: isColumns ? "y" : axisRef("y", index),
      hovertemplate:
        (isColumns
          ? `${panelTitle}: %{x}<br>${sharedTitle}: %{y}`
          : `${sharedTitle}: %{x}<br>${panelTitle}: %{y}`) +
        (colorInHover ? `<br>${colorTitle}: %{customdata}` : "") +
        "<extra></extra>",
      // The markers carry the third dimension; the line still carries the
      // variable's own colour, which is what says WHICH panel this is.
      marker: hasColorBar
        ? { color: colorDimension.values, coloraxis: "coloraxis" }
        : { color },
      line: { color },
      ...(hasColorBar ? { customdata: colorDimension.hoverValues } : {}),
    };
  });

  // Last, so that adding a colour column cannot shift the index of any panel's
  // own label.
  if (hasColorBar)
    annotations.push(colorBarLabel(wrapColorBarLabel(colorTitle)));

  layout.annotations = annotations;
  return { data: traces, layout };
}
