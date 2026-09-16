import { describe, it, expect } from "vitest";

import { paletteFor } from "./erddapPalettes.js";

// paletteColorFor/contrastOnWhite/MIN_TRACE_CONTRAST are exhaustively covered
// by previewColors.test.mjs (node:test). paletteFor itself — the raw ramp
// lookup those build on — wasn't exercised directly by anything there.
describe("paletteFor", () => {
  it("returns the five-stop Plotly ramp for a mapped palette name", () => {
    const ramp = paletteFor("KT_thermal");
    expect(ramp).toHaveLength(5);
    expect(ramp[0]).toEqual([0, "#042333"]);
    expect(ramp[4]).toEqual([1, "#f9e07d"]);
  });

  it("returns undefined for an unmapped or missing name", () => {
    expect(paletteFor("Ocean")).toBeUndefined();
    expect(paletteFor("")).toBeUndefined();
    expect(paletteFor(undefined)).toBeUndefined();
  });
});
