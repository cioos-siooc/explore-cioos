// How wide the plot's parameters pane may be, and the clamp every change to it
// commits through. Pure: the bounds are where a resizable pane goes wrong, and
// they are assertable without a browser.

import { MIN_PLOT_PX } from "./previewFacetSizing.js";

// 90px of caption plus the row's 8px gap leaves about 100px of dropdown, which
// still reads.
export const PANE_MIN_PX = 200;
export const PANE_DEFAULT_PX = 240;
export const PANE_MAX_PX = 424;

// Committed widths land on this grid, so a drag costs one re-plot per step
// rather than one per pointermove — every new width rebuilds the figure and
// re-runs Plotly.react over every trace. Every bound above is a multiple of it,
// which is what makes the clamp idempotent.
export const PANE_STEP_PX = 8;

const gridFloor = (px) => Math.floor(px / PANE_STEP_PX) * PANE_STEP_PX;
const gridRound = (px) => Math.round(px / PANE_STEP_PX) * PANE_STEP_PX;

/**
 * @param next            the width asked for, in pixels
 * @param paneWidth       the pane's measured width
 * @param plotWidth       the plot pane's measured width
 *
 * The ceiling comes from the two measured boxes rather than from the row's own
 * width less a gutter constant: the gap and the divider are in neither box, so
 * they fall out of the sum on their own. Before anything is measured the static
 * maximum stands in.
 */
export function clampPaneWidth(next, { paneWidth = 0, plotWidth = 0 } = {}) {
  const row = Math.max(paneWidth || 0, 0) + Math.max(plotWidth || 0, 0);
  const room = row > 0 ? gridFloor(row - MIN_PLOT_PX) : PANE_MAX_PX;
  const ceiling = Math.max(Math.min(PANE_MAX_PX, room), PANE_MIN_PX);
  const wanted = Number.isFinite(next) ? next : PANE_DEFAULT_PX;
  return Math.max(PANE_MIN_PX, Math.min(gridRound(wanted), ceiling));
}
