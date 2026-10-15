import { test } from "node:test";
import assert from "node:assert/strict";

import {
  maxCharsFor,
  titleLinesFor,
  wrapLabel,
  wrapTitleFor,
  MAX_TITLE_LINES,
} from "./previewLabelText.js";

const TITLE = "Station Id: PMZA-RIKI — Profile: PMZA-RIKI-25/09/16-17:35:26";

test("a label that fits is left alone", () => {
  assert.equal(wrapLabel("Depth ( m )", 40), "Depth ( m )");
});

test("the unit goes on its own line first", () => {
  assert.equal(
    wrapLabel("Practical Salinity ( PSU )", 20),
    "Practical Salinity<br>( PSU )",
  );
});

test("a long name wraps at word boundaries, never mid-word", () => {
  const wrapped = wrapLabel("Mass concentration of chlorophyll ( mg m-3 )", 22);
  wrapped.split("<br>").forEach((line) => {
    assert.ok(line.length <= 22 || !line.includes(" "), line);
  });
  assert.ok(!wrapped.includes("chloro<br>"));
});

test("past the line cap the name is truncated and the unit survives", () => {
  const wrapped = wrapLabel(
    "Mass concentration of chlorophyll a in sea water estimated from fluorescence ( mg m-3 )",
    21,
  );
  const lines = wrapped.split("<br>");
  assert.equal(lines.length, 3);
  assert.ok(lines[1].endsWith("…"));
  assert.equal(lines[2], "( mg m-3 )");
});

test("a label with no unit still wraps, using every allowed line", () => {
  const lines = wrapLabel(
    "some very long variable name with no unit",
    14,
  ).split("<br>");
  assert.equal(lines.length, 3);
  assert.ok(lines.every((line) => !line.startsWith("(")));
});

test("an unknown width means do not wrap", () => {
  // buildFigure runs once before the plot area has been measured; wrapping
  // against a guessed width would be worse than not wrapping.
  assert.equal(maxCharsFor(0), 0);
  assert.equal(maxCharsFor(undefined), 0);
  assert.equal(
    wrapLabel("Practical Salinity ( PSU )", 0),
    "Practical Salinity ( PSU )",
  );
});

test("narrower panels allow fewer characters", () => {
  assert.ok(maxCharsFor(150) < maxCharsFor(170));
  assert.ok(maxCharsFor(170) < maxCharsFor(1140));
  assert.ok(maxCharsFor(10) >= 8); // a floor, so a label is never one char a line
});

test("the title wraps at the line cap rather than overflowing the figure", () => {
  const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
  const lines = wrapTitleFor(long, 320).split("<br>");
  assert.equal(lines.length, MAX_TITLE_LINES);
  assert.ok(lines[lines.length - 1].endsWith("…"));
  // Wrapped at the FIGURE's width, not a panel's: it is centred on the figure.
  assert.ok(titleLinesFor(TITLE, 1140) < titleLinesFor(TITLE, 400));
});
