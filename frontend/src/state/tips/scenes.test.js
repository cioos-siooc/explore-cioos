import { describe, it, expect } from "vitest";

import { findGridded } from "./scenes.js";

describe("findGridded", () => {
  it("finds the first dataset with a WMS server", () => {
    const grid = { dataset_id: "grid", wms_url: "https://a/wms" };
    expect(
      findGridded([{ dataset_id: "plain" }, grid, { wms_url: "https://b" }]),
    ).toBe(grid);
  });

  it("finds nothing without a WMS server", () => {
    expect(findGridded([{ dataset_id: "plain" }])).toBeUndefined();
  });
});
