import { describe, it, expect } from "vitest";

import platformColors from "./platformColors.js";

describe("platformColors", () => {
  it("gives every platform a unique, valid hex color", () => {
    const platforms = platformColors.map((entry) => entry.platform);
    expect(new Set(platforms).size).toBe(platforms.length);
    platformColors.forEach((entry) => {
      expect(entry.color).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  it("covers every platform MultiCheckboxFilter's colored mode needs (matches platforms.json)", () => {
    // The Platforms filter renders a swatch per option (colored prop) — a
    // platform present in the catalog but missing here would silently fall
    // back to black rather than fail loudly, so pin the known set.
    const platforms = platformColors.map((entry) => entry.platform);
    ["mooring", "surface vessel", "unknown", "land or seafloor"].forEach(
      (platform) => expect(platforms).toContain(platform),
    );
  });
});
