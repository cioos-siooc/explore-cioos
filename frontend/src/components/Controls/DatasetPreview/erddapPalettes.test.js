import { describe, it, expect } from "vitest";

import { paletteFor } from "./erddapPalettes.js";

// The rest of this module is covered by previewColors.test.mjs.
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
