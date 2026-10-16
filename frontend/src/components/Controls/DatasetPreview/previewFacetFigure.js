// Explicit axis domains rather than layout.grid: Plotly resolves a grid only
// against a real DOM, and computing them here keeps the layout assertable under
// `node --test`. Labels beside a vertical axis are annotations, not axis
// titles, because Plotly always rotates a y-axis title; horizontal labels stay
// axis titles to keep automargin. The figure carries its own title because a
// downloaded PNG has nothing else naming the record.

import { COLUMNS } from "./previewFacetPlan.js";
import { labelFor, shortLabelFor } from "./previewVariables.js";
import { defaultColorFor } from "./previewColors.js";

// Left gutter, in both orientations: tick labels, then the horizontally written
// axis label.
const TICK_ROOM_PX = 52;
export const LABEL_GUTTER_PX = 104;

// Excludes the figure title, which marginFor() adds on top.
const COLUMNS_MARGIN = {
  l: TICK_ROOM_PX + LABEL_GUTTER_PX,
  r: 26,
  t: 54,
  b: 22,
};
const ROWS_MARGIN = { l: TICK_ROOM_PX + LABEL_GUTTER_PX, r: 26, t: 30, b: 62 };

export const TITLE_FONT_PX = 14;
// 14px at Plotly's LINE_SPACING of 1.3 is 18.2; 19 buys a pixel of clearance.
const TITLE_LINE_PX = 19;
const TITLE_PAD_PX = 10;
export const MAX_TITLE_LINES = 2;

export function titleRoomFor(lineCount) {
  return lineCount > 0 ? TITLE_PAD_PX + lineCount * TITLE_LINE_PX : 0;
}

// `titleLines` defaults to the worst case for callers that cannot measure it.
export function marginFor(orientation, titleLines = MAX_TITLE_LINES) {
  const base = orientation === COLUMNS ? COLUMNS_MARGIN : ROWS_MARGIN;
  return { ...base, t: base.t + titleRoomFor(titleLines) };
}

// Gap as a fraction of one panel, not of the plotting area: area-relative gaps
// left nineteen panels about a pixel wide. 0.22 fits six 150 px profile panels
// in a ~1140 px modal; stacked panels need less, as vertical space is scarce.
const COLUMN_GAP = 0.22;
const ROW_GAP = 0.12;
// Below this a panel is not worth drawing; the container scrolls instead.
export const MIN_PANEL_PX = 150;
export const MIN_PLOT_PX = 320;

// Explicit rather than Plotly's axis-title default (14) so maxCharsFor() can
// predict rendered width.
export const LABEL_FONT_PX = 12;
// Average advance per character for Plotly's default font stack, as a fraction
// of font size. Deliberately generous: overestimating wraps a word early,
// underestimating overlaps neighbouring panel titles.
const CHAR_PX_PER_FONT_PX = 0.58;
const MAX_LABEL_LINES = 3;

// 0 means unmeasured; callers treat it as "do not wrap".
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

// <br> is what Plotly reads and counts when growing a margin. Words are never
// split; past `maxLines` the name is truncated but the unit line is kept, since
// a label without its unit reads as a different quantity.
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

// Against the whole figure width: the title is centred on the figure.
export function wrapTitleFor(title, widthPx) {
  return wrapLabel(title, maxCharsFor(widthPx, TITLE_FONT_PX), MAX_TITLE_LINES);
}

export function titleLinesFor(title, widthPx) {
  const wrapped = wrapTitleFor(title, widthPx);
  return wrapped ? wrapped.split("<br>").length : 0;
}

// Both the domains and the size floors derive from this, so they cannot drift
// apart.
export function panelPitch(n, gapRatio) {
  return n <= 0 ? 0 : n + (n - 1) * gapRatio;
}

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
  // Plotly wants the full 0..1 covered exactly.
  domains[0][0] = 0;
  domains[n - 1][1] = 1;
  return domains;
}

// Constant for profiles (one shared depth axis); grows for stacked panels.
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

// The floor keeps a 14-column selection legible at the cost of a horizontal
// scroll.
export function plotWidthFor(orientation, panelCount, availableWidth) {
  const available = Math.max(availableWidth || 0, MIN_PLOT_PX);
  if (orientation !== COLUMNS) return available;
  const margin = marginFor(orientation);
  const needed =
    MIN_PANEL_PX * panelPitch(panelCount, COLUMN_GAP) + margin.l + margin.r;
  return Math.ceil(Math.max(available, needed));
}

const axisKey = (letter, index) =>
  index === 0 ? `${letter}axis` : `${letter}axis${index + 1}`;
const axisRef = (letter, index) =>
  index === 0 ? letter : `${letter}${index + 1}`;

// Where Plotly would put the axis title, but horizontal; `y` is the centre of
// the labelled span in paper coordinates.
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

// Wraps into the fixed gutter, so it works on first render; four 12px lines fit
// a MIN_PANEL_PX panel.
const wrapAxisLabel = (text) =>
  wrapLabel(text, maxCharsFor(LABEL_GUTTER_PX), 4);

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

// `colors` holds the user's overrides only; `title` is plain text, wrapped here.
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

  const wrappedTitle = wrapTitleFor(title, size.width);
  const titleLines = wrappedTitle ? wrappedTitle.split("<br>").length : 0;
  const margin = marginFor(plan.orientation, titleLines);
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
    // title.automargin deliberately unset: it would grow the margin inside a
    // fixed height and silently shrink panels below MIN_PANEL_PX.
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

  const sharedTitle = titleFor(sharedAxis);

  if (isColumns) {
    layout.yaxis = {
      automargin: true,
      domain: [0, 1],
      anchor: "x",
      ...(plan.sharedReversed ? { autorange: "reversed" } : {}),
    };
    annotations.push(axisLabel(wrapAxisLabel(sharedTitle), 0.5));
  } else {
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
        side: "top",
        title: {
          // Wrapped to its own panel's width, not the plot's.
          text: wrapAt(panelTitle, plottingWidth * (domain[1] - domain[0])),
          font: { size: LABEL_FONT_PX },
          standoff: 6,
        },
        zeroline: false,
      };
    } else {
      // y domains count up from the bottom, so the first variable is lowest.
      layout[axisKey("y", index)] = {
        domain,
        anchor: "x",
        automargin: true,
        zeroline: false,
      };
      annotations.push(
        axisLabel(wrapAxisLabel(panelTitle), (domain[0] + domain[1]) / 2),
      );
    }

    const sharedValues = (data || []).map((row) => row[sharedAxis]);
    const panelValues = (data || []).map((row) => row[columnName]);
    const color =
      colors[columnName] ||
      defaultColorFor(variablesByName.get(columnName), index);

    return {
      type: "scatter",
      mode,
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
          : `${sharedTitle}: %{x}<br>${panelTitle}: %{y}`) + "<extra></extra>",
      marker: { color },
      line: { color },
    };
  });

  layout.annotations = annotations;
  return { data: traces, layout };
}
