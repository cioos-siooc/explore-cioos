import { test } from "node:test";
import assert from "node:assert/strict";

import { COLUMNS, ROWS } from "./previewFacetPlan.js";
import {
  boxBudgetFor,
  domainsFor,
  heightBudgetFor,
  marginFor,
  panelPitch,
  plotHeightFor,
  plotWidthFor,
  titleRoomFor,
  MIN_PANEL_PX,
} from "./previewFacetSizing.js";

test("one panel fills the plotting area", () => {
  assert.deepEqual(domainsFor(1, 0.05), [[0, 1]]);
});

test("domains are ordered, non-overlapping and inside 0..1", () => {
  for (const n of [1, 2, 3, 4, 5, 6, 14]) {
    const domains = domainsFor(n, 0.05);
    assert.equal(domains.length, n, `n=${n}`);
    assert.equal(domains[0][0], 0, `n=${n} starts at 0`);
    assert.equal(domains[n - 1][1], 1, `n=${n} ends at 1`);
    domains.forEach(([start, end], i) => {
      assert.ok(end > start, `n=${n} panel ${i} has width`);
      assert.ok(start >= 0 && end <= 1, `n=${n} panel ${i} inside 0..1`);
      if (i)
        assert.ok(
          start > domains[i - 1][1],
          `n=${n} panel ${i} clears ${i - 1}`,
        );
    });
  }
});

test("domains carry no float drift past 1", () => {
  // Plotly rejects a domain whose end lands at 1.0000000000000002.
  for (const n of [3, 6, 7, 9, 11, 13]) {
    assert.ok(domainsFor(n, 0.055)[n - 1][1] <= 1, `n=${n}`);
  }
});

test("no panels means no domains", () => {
  assert.deepEqual(domainsFor(0, 0.05), []);
});

test("profile height is constant in panel count — panels share one depth axis", () => {
  const heights = [1, 2, 3, 6, 14].map((n) => plotHeightFor(COLUMNS, n, 600));
  assert.deepEqual(heights, [600, 600, 600, 600, 600]);
});

test("stacked height grows with panel count, never below the space available", () => {
  assert.equal(plotHeightFor(ROWS, 1, 600), 600);
  const six = plotHeightFor(ROWS, 6, 600);
  assert.ok(
    six >= 6 * MIN_PANEL_PX,
    `${six} fits six ${MIN_PANEL_PX}px panels`,
  );
  const heights = [1, 2, 3, 4, 5, 6].map((n) => plotHeightFor(ROWS, n, 600));
  for (let i = 1; i < heights.length; i += 1) {
    assert.ok(heights[i] >= heights[i - 1], "monotonic in n");
  }
});

test("a collapsed container still gets a usable height", () => {
  // This is the first-render case: the measured height is 0 until the modal
  // lays out, and Plotly used to silently fall back to its own 450px default.
  assert.ok(plotHeightFor(COLUMNS, 1, 0) > 0);
  assert.ok(plotHeightFor(ROWS, 1, undefined) > 0);
});

test("profile width grows past the container once panels hit their floor", () => {
  assert.equal(plotWidthFor(COLUMNS, 2, 1000), 1000);
  assert.ok(plotWidthFor(COLUMNS, 14, 1000) > 1000);
  // Stacked panels never widen — they share one x axis.
  assert.equal(plotWidthFor(ROWS, 14, 1000), 1000);
});

test("each orientation reserves the edge its labels actually use", () => {
  // Without the title, which sits at the top of both.
  const columns = marginFor(COLUMNS, 0);
  const rows = marginFor(ROWS, 0);
  // A profile's panel titles are on top and nothing is drawn at its bottom; a
  // stack is the other way round.
  assert.ok(columns.t > columns.b);
  assert.ok(rows.b > rows.t);
  // Neither reserves width for a rotated title any more.
  assert.equal(columns.l, rows.l);
  // And the title is added to the top of each, never taken out of it.
  assert.equal(marginFor(COLUMNS, 2).t - columns.t, titleRoomFor(2));
  assert.equal(marginFor(ROWS, 2).t - rows.t, titleRoomFor(2));
});

test("the sizing floors pay for the gaps, so a panel really gets its minimum", () => {
  // The floors used to be n * MIN_PANEL_PX, which ignored the gaps between the
  // panels — so six panels were promised 150px each and drawn at 109px.
  for (const n of [2, 6, 14, 19]) {
    const width = plotWidthFor(COLUMNS, n, 100);
    const columns = marginFor(COLUMNS);
    const plotting = width - columns.l - columns.r;
    const [start, end] = domainsFor(n, 0.22)[0];
    assert.ok(
      plotting * (end - start) >= MIN_PANEL_PX - 1,
      `n=${n}: ${(plotting * (end - start)).toFixed(0)}px panel`,
    );

    const height = plotHeightFor(ROWS, n, 100);
    const rows = marginFor(ROWS);
    const stacked = height - rows.t - rows.b;
    const [low, high] = domainsFor(n, 0.12)[0];
    assert.ok(
      stacked * (high - low) >= MIN_PANEL_PX - 1,
      `n=${n}: ${(stacked * (high - low)).toFixed(0)}px panel`,
    );
  }
});

test("the gap is a share of a panel, not of the whole plot", () => {
  // At a fixed 5.5% of the plotting area, nineteen panels spent 99% of the
  // width on the eighteen gaps and each panel came out about a pixel wide.
  const domains = domainsFor(19, 0.22);
  const span = domains[0][1] - domains[0][0];
  assert.ok(span > 0.03, `${span} of the width per panel`);
  const gap = domains[1][0] - domains[0][1];
  assert.ok(
    Math.abs(gap / span - 0.22) < 0.01,
    `gap is ${(gap / span).toFixed(3)} of a panel`,
  );
  assert.equal(panelPitch(19, 0.22), 19 + 18 * 0.22);
  assert.equal(panelPitch(1, 0.22), 1);
  assert.equal(panelPitch(0, 0.22), 0);
});

test("a measured box is spent one pixel short of what it reported", () => {
  // clientWidth/clientHeight are integers rounded from a fractional box, so the
  // number reported can be half a pixel more than the box that has to hold the
  // figure — and in a scroll container that half pixel is a stub scrollbar on
  // one axis that then takes ~15px from the other.
  assert.equal(boxBudgetFor(700), 699);
  assert.equal(boxBudgetFor(699.6), 698);
  assert.equal(boxBudgetFor(0), 0);
  assert.equal(boxBudgetFor(undefined), 0);
});

test("the height budget is the plot pane's own box, scrollbar and all", () => {
  // A horizontal scrollbar took 15px of the pane; that is measured, never
  // guessed at a constant, because it is 0 on overlay-scrollbar platforms.
  assert.equal(heightBudgetFor(700, 685), 684);
  // Nothing measured yet (first render): the scroller is all there is to go on.
  assert.equal(heightBudgetFor(700, 0), 699);
});

test("the height budget can only ever come down — no growth loop", () => {
  // The guard that makes it safe to measure the plot's OWN pane here: a pane
  // reporting taller than the scroller it sits in cannot buy the figure room.
  assert.equal(heightBudgetFor(700, 900), 699);
  let previous = Infinity;
  for (const paneHeight of [900, 800, 700, 600, 400, 200, 0]) {
    const budget = heightBudgetFor(700, paneHeight);
    if (paneHeight > 0) {
      assert.ok(budget <= previous, `${paneHeight}px pane -> ${budget}px`);
      previous = budget;
    }
    assert.ok(budget >= 0);
  }
  assert.equal(heightBudgetFor(0, 0), 0);
  // And an empty budget still cannot collapse the figure (see the first-render
  // case above).
  assert.ok(plotHeightFor(COLUMNS, 1, heightBudgetFor(0, 0)) > 0);
});
