// How much room the figure gets and how it is divided: margins, panel domains,
// and the floors below which a panel stops being worth drawing.
//
// Kept apart from the figure itself because the component has to choose a width
// and a height BEFORE it can build one, and because arithmetic this fiddly is
// worth asserting on its own.

import { COLUMNS } from "./previewFacetPlan.js";
import { MAX_LABEL_LINES, MAX_TITLE_LINES } from "./previewLabelText.js";

// Left of every vertical axis: room for its tick labels, then room for the
// axis's own label, which runs along the axis and so needs only its line
// height — two 18px lines here, automargin covers a third. Reserved by a
// stack's margin and by a profile's pinned strip, both left of a vertical axis.
export const TICK_ROOM_PX = 48;
export const LABEL_GUTTER_PX = 48;

// Above a profile's panels: their tick labels and the title standoff. The panel
// titles' own lines are added per line, so they never reach the figure title.
export const TOP_TICK_ROOM_PX = 32;
// 18px at Plotly's LINE_SPACING of 1.3 is 23.4.
export const LABEL_LINE_PX = 24;

// The shared axis is drawn in a strip of its own outside the scroller (see
// previewPinnedAxis.js), so it stays in view however far the panels scroll: a
// profile's on the left, a stack's at the bottom. The figure keeps only enough
// of that edge not to clip the axis line. The title is capped at two lines,
// because a strip sized from its title would feed back into the figure's size.
export const PINNED_AXIS_LINES = 2;
const BOTTOM_TICK_ROOM_PX = 28;
export const PINNED_EDGE_PX = 4;

export function pinnedAxisSizeFor(orientation) {
  const tickRoom = orientation === COLUMNS ? TICK_ROOM_PX : BOTTOM_TICK_ROOM_PX;
  return tickRoom + PINNED_AXIS_LINES * LABEL_LINE_PX;
}

// Orientation-dependent because the two layouts spend their other edges
// differently: a profile puts its panel titles on TOP and nothing at the
// bottom, a stack labels each panel's own axis on the LEFT.
const COLUMNS_MARGIN = {
  l: PINNED_EDGE_PX,
  r: 26,
  t: TOP_TICK_ROOM_PX,
  b: 22,
};
const ROWS_MARGIN = {
  l: TICK_ROOM_PX + LABEL_GUTTER_PX,
  r: 26,
  t: 30,
  b: PINNED_EDGE_PX,
};

// Right of a colour plot's panels: each one's own colourbar, its tick labels and
// its sideways title.
export const COLORBAR_ROOM_PX = 96;

// 14px at Plotly's LINE_SPACING of 1.3 is 18.2; 19 buys a pixel of clearance
// rather than spending one.
const TITLE_LINE_PX = 19;
export const TITLE_PAD_PX = 10;

// Nothing at all when there is no title — a record whose columns carry no
// cf_role value must not pay for one.
export function titleRoomFor(lineCount) {
  return lineCount > 0 ? TITLE_PAD_PX + lineCount * TITLE_LINE_PX : 0;
}

/**
 * Both line counts default to the worst case, so the sizing floors reserve room
 * for labels they cannot measure; buildFigure passes the counts it wrapped to.
 * `panelTitleLines` only counts for a profile, whose panel titles are on top.
 */
export function marginFor(
  orientation,
  titleLines = MAX_TITLE_LINES,
  panelTitleLines = MAX_LABEL_LINES,
) {
  if (orientation !== COLUMNS) {
    return { ...ROWS_MARGIN, t: ROWS_MARGIN.t + titleRoomFor(titleLines) };
  }
  return {
    ...COLUMNS_MARGIN,
    t:
      COLUMNS_MARGIN.t +
      panelTitleLines * LABEL_LINE_PX +
      titleRoomFor(titleLines),
  };
}

// Gap between panels, as a fraction of ONE PANEL rather than of the whole
// plotting area: at 5.5% of the area each, nineteen panels spend 99% of the
// width on the eighteen gaps between them. A panel-relative gap keeps the same
// proportions at any n.
//
// 0.22 is also what makes six 150px profile panels fit a ~1140px modal exactly.
// Stacked panels need much less — every panel is labelled beside its own axis
// and only the bottom one carries tick labels, so the gap is separation and
// nothing else, and vertical space is the direction the modal scrolls.
export const COLUMN_GAP = 0.22;
export const ROW_GAP = 0.12;

// Below this a panel is not worth drawing; the container scrolls instead.
export const MIN_PANEL_PX = 150;
export const MIN_PLOT_PX = 320;

// The plotting area a panel count needs, in panels: n panels plus the gaps
// between them, each gap being `gapRatio` of a panel. Both the domains and the
// minimum-size floors derive from it, so they cannot drift apart.
export function panelPitch(n, gapRatio) {
  return n <= 0 ? 0 : n + (n - 1) * gapRatio;
}

// n evenly spaced [start, end] pairs over 0..1.
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

// clientWidth/clientHeight are integers rounded from a box that is fractional
// whenever `calc(100vh - 32px)` is, so the size reported can be half a pixel
// MORE than the box that has to hold the figure. In a scroll container that half
// pixel is a stub scrollbar on one axis, which then takes ~15px from the other,
// and both stay. Spending one pixel less makes the figure strictly smaller than
// its box, so it never grows a scrollbar at all.
const SUBPIXEL_PX = 1;

export function boxBudgetFor(measuredPx) {
  return Math.max(Math.floor(measuredPx || 0) - SUBPIXEL_PX, 0);
}

// `paneHeight` is the same box as `availableHeight` less whatever a horizontal
// scrollbar took — nothing on overlay-scrollbar platforms, ~15px with classic
// ones — which is why it is measured rather than guessed at a constant.
//
// The min() is what makes it safe to measure the plot's OWN pane here: the
// budget can only ever come down, so no CSS arrangement lets a taller figure buy
// itself more room. 0 means "not measured yet".
export function heightBudgetFor(availableHeight, paneHeight) {
  const available = Math.max(availableHeight || 0, 0);
  return boxBudgetFor(
    paneHeight > 0 ? Math.min(paneHeight, available) : available,
  );
}

// Constant in n for profiles, whose panels sit side by side and share one depth
// axis; growing for stacked panels, which is where "as many variables as the
// dataset has" and "no overflow" genuinely conflict.
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

// MIN_PLOT_PX stands in for a box not measured yet. A measured width is all
// there is — a phone's is under it — and flooring it only adds a sideways
// scroll; the panels' own minimum still applies.
const widthBudgetFor = (availableWidth) =>
  availableWidth > 0 ? availableWidth : MIN_PLOT_PX;

// Profiles get narrow fast: six panels in a 1140px modal is ~170px each, which
// still reads. The floor keeps a 14-column selection legible at the cost of a
// horizontal scroll.
export function plotWidthFor(orientation, panelCount, availableWidth) {
  const available = widthBudgetFor(availableWidth);
  if (orientation !== COLUMNS) return available;
  const margin = marginFor(orientation, MAX_TITLE_LINES);
  const needed =
    MIN_PANEL_PX * panelPitch(panelCount, COLUMN_GAP) + margin.l + margin.r;
  return Math.ceil(Math.max(available, needed));
}

// A grid of panels (several variables on both axes): nothing is pinned, so the
// figure keeps every edge's tick labels and titles itself — X titles under
// each column, Y titles left of each row — and `header` adds room above the
// columns naming what each one is coloured by, as many lines as an X title.
const GRID_MARGIN = {
  l: TICK_ROOM_PX + LABEL_GUTTER_PX,
  r: 26,
  t: 30,
  b: BOTTOM_TICK_ROOM_PX + PINNED_AXIS_LINES * LABEL_LINE_PX,
};

export function gridMarginFor(
  titleLines = MAX_TITLE_LINES,
  { header = false, colorbars = false } = {},
) {
  return {
    ...GRID_MARGIN,
    r: GRID_MARGIN.r + (colorbars ? COLORBAR_ROOM_PX : 0),
    t:
      GRID_MARGIN.t +
      (header ? PINNED_AXIS_LINES * LABEL_LINE_PX : 0) +
      titleRoomFor(titleLines),
  };
}

// Every panel at least MIN_PANEL_PX square; the scroller takes the rest.
export function gridSizeFor({
  columns,
  rows,
  availableWidth,
  availableHeight,
  margin,
}) {
  const needed = (count, gap) => MIN_PANEL_PX * panelPitch(count, gap);
  return {
    width: Math.ceil(
      Math.max(
        widthBudgetFor(availableWidth),
        needed(columns, COLUMN_GAP) + margin.l + margin.r,
      ),
    ),
    height: Math.ceil(
      Math.max(
        Math.max(availableHeight || 0, MIN_PLOT_PX),
        needed(rows, ROW_GAP) + margin.t + margin.b,
      ),
    ),
  };
}

// One plot with every variable on an axis of its own (see buildOverlayFigure).
// Nothing is pinned, so the figure keeps the shared axis's ticks and title. A
// profile's value axes all run across the top, each past the first a
// STACKED_AXIS_PX step further up; a stack's all run up the left, and Plotly's
// autoshift places the extra ones from their measured labels.
export const MAX_STACKED_AXES = 4;
export const STACKED_AXIS_PX =
  TOP_TICK_ROOM_PX + PINNED_AXIS_LINES * LABEL_LINE_PX;
const SIDE_AXIS_ROOM_PX = TICK_ROOM_PX + LABEL_GUTTER_PX;

export function overlayMarginFor(orientation, titleLines = MAX_TITLE_LINES) {
  const titleRoom = titleRoomFor(titleLines);
  if (orientation === COLUMNS) {
    return {
      l: SIDE_AXIS_ROOM_PX,
      r: 26,
      t: 10 + STACKED_AXIS_PX + titleRoom,
      b: 22,
    };
  }
  return {
    l: SIDE_AXIS_ROOM_PX,
    r: 26,
    t: 30 + titleRoom,
    b: BOTTOM_TICK_ROOM_PX + PINNED_AXIS_LINES * LABEL_LINE_PX,
  };
}
