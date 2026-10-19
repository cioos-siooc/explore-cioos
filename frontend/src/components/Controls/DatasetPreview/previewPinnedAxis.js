// The shared axis, drawn in a strip of its own outside the plot's scroller, so
// its scale and its title stay in view however far the panels scroll.
//
// The strip is a second Plotly figure rather than an axis drawn by hand: given
// the same range over the same length, Plotly picks the same ticks, so the
// strip's labels land on the main figure's gridlines. Both the range and the
// length are read back from the main figure once it has been drawn, because
// autorange, zoom and automargin all settle them inside Plotly.

import pick from "lodash-es/pick.js";

import { COLUMNS } from "./previewFacetPlan.js";
import { pinnedAxisSizeFor } from "./previewFacetSizing.js";
import { TICK_FONT_PX } from "./previewLabelText.js";

// A profile shares its vertical axis, a stack (and the colour plot) its
// horizontal one.
export const PINNED_AXIS_LETTER = { [COLUMNS]: "y" };
const pinnedLetterFor = (orientation) => PINNED_AXIS_LETTER[orientation] || "x";

// What the strip draws of the axis: its label and its scale. The rest — spikes,
// hover, domain, anchor — belongs to the panels it runs along.
const DRAWN_KEYS = ["title", "tickmode", "tickvals", "ticktext"];

// Plotly's smallest plot area with explicit margins (MIN_SPECIFIED_HEIGHT).
const STRIP_PLOT_PX = 2;

const TRANSPARENT = "rgba(0,0,0,0)";

/**
 * The main figure with its shared axis still there — gridlines, spikes, the
 * unified hover — but unlabelled, and that axis's label and scale for the strip.
 */
export function splitPinnedAxis(figure, orientation) {
  const key = `${pinnedLetterFor(orientation)}axis`;
  const axis = figure.layout[key];
  return {
    figure: {
      ...figure,
      layout: {
        ...figure.layout,
        [key]: { ...axis, showticklabels: false, title: { text: "" } },
      },
    },
    axis: pick(axis, DRAWN_KEYS),
  };
}

// `_fullLayout` is Plotly's resolved layout, and the only place the range it
// autoranged to and the margins automargin grew are kept.
export function pinnedViewFor(fullLayout, orientation) {
  const axis = fullLayout[`${pinnedLetterFor(orientation)}axis`];
  const { l, r, t, b } = fullLayout._size;
  return {
    range: [...axis.range],
    type: axis.type,
    width: fullLayout.width,
    height: fullLayout.height,
    l,
    r,
    t,
    b,
  };
}

/**
 * The strip's own figure: no data, a plot area two pixels deep against the
 * panels, and the axis drawn into the rest. Static — zooming is done on the
 * panels, and the strip follows.
 */
export function pinnedAxisFigureFor(axis, view, orientation) {
  const thickness = pinnedAxisSizeFor(orientation);
  const vertical = orientation === COLUMNS;
  const drawnAxis = {
    ...axis,
    range: view.range,
    type: view.type,
    autorange: false, // a reversed range stays reversed as it was read
    automargin: false, // the strip's size is fixed; nothing may push it
    fixedrange: true,
    showgrid: false,
    zeroline: false,
  };
  const hiddenAxis = { visible: false, fixedrange: true };
  return {
    data: [],
    layout: {
      ...(vertical
        ? {
            width: thickness,
            height: view.height,
            margin: {
              l: thickness - STRIP_PLOT_PX,
              r: 0,
              t: view.t,
              b: view.b,
              pad: 0,
              autoexpand: false,
            },
            xaxis: hiddenAxis,
            yaxis: drawnAxis,
          }
        : {
            width: view.width,
            height: thickness,
            margin: {
              l: view.l,
              r: view.r,
              t: 0,
              b: thickness - STRIP_PLOT_PX,
              pad: 0,
              autoexpand: false,
            },
            xaxis: drawnAxis,
            yaxis: hiddenAxis,
          }),
      font: { size: TICK_FONT_PX },
      showlegend: false,
      paper_bgcolor: TRANSPARENT,
      plot_bgcolor: TRANSPARENT,
    },
  };
}
