import { test } from "node:test";
import assert from "node:assert/strict";

import { MIN_PLOT_PX } from "./previewFacetFigure.js";
import {
  clampPaneWidth,
  PANE_DEFAULT_PX,
  PANE_MAX_PX,
  PANE_MIN_PX,
  PANE_STEP_PX,
} from "./previewPaneLayout.js";

// The whole row of a 1140px modal, near enough: the gap and the divider are in
// neither measured box, so the two simply add up.
const ROOM = { paneWidth: 240, plotWidth: 860 };

test("the bounds hold whatever the drag asks for", () => {
  assert.equal(clampPaneWidth(40, ROOM), PANE_MIN_PX);
  assert.equal(clampPaneWidth(4000, ROOM), PANE_MAX_PX);
  assert.equal(clampPaneWidth(320, ROOM), 320);
});

test("the figure keeps MIN_PLOT_PX however far the divider is dragged", () => {
  // A narrow modal: the static maximum would leave the figure 96px.
  const cramped = { paneWidth: 240, plotWidth: 280 };
  const widest = clampPaneWidth(PANE_MAX_PX, cramped);
  assert.ok(widest < PANE_MAX_PX, `${widest} is below the static maximum`);
  assert.ok(
    cramped.paneWidth + cramped.plotWidth - widest >= MIN_PLOT_PX,
    `${widest} leaves the figure at least ${MIN_PLOT_PX}px`,
  );
  // Never below the floor, even when there is no room for one at all.
  assert.equal(
    clampPaneWidth(400, { paneWidth: 200, plotWidth: 60 }),
    PANE_MIN_PX,
  );
});

test("the static maximum stands in until something has been measured", () => {
  assert.equal(clampPaneWidth(PANE_MAX_PX), PANE_MAX_PX);
  assert.equal(
    clampPaneWidth(PANE_MAX_PX, { paneWidth: 0, plotWidth: 0 }),
    PANE_MAX_PX,
  );
});

test("committed widths land on the step grid, and clamping is idempotent", () => {
  // One re-plot per step of the drag rather than one per pointermove.
  for (const asked of [201, 237, 244, 318, 419]) {
    const once = clampPaneWidth(asked, ROOM);
    assert.equal(once % PANE_STEP_PX, 0, `${asked} -> ${once} is on the grid`);
    assert.equal(clampPaneWidth(once, ROOM), once, `${once} is a fixed point`);
  }
  for (const bound of [PANE_MIN_PX, PANE_DEFAULT_PX, PANE_MAX_PX]) {
    assert.equal(bound % PANE_STEP_PX, 0, `${bound} is on the grid`);
  }
});

test("an unmeasured or nonsense width falls back to the default", () => {
  assert.equal(clampPaneWidth(undefined, ROOM), PANE_DEFAULT_PX);
  assert.equal(clampPaneWidth(NaN, ROOM), PANE_DEFAULT_PX);
  assert.equal(clampPaneWidth(Infinity, ROOM), PANE_DEFAULT_PX);
  assert.equal(
    clampPaneWidth(320, { paneWidth: NaN, plotWidth: undefined }),
    320,
  );
});
