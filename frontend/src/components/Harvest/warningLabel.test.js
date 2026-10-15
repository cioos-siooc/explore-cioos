import { describe, it, expect, vi } from "vitest";
import warningLabel from "./warningLabel.js";
import en from "../../locales/en/translation.json";
import fr from "../../locales/fr/translation.json";

describe("warningLabel", () => {
  it("returns an empty string without a code", () => {
    const t = vi.fn();
    expect(warningLabel(t, undefined)).toBe("");
    expect(t).not.toHaveBeenCalled();
  });

  it("looks the code up under harvest.warning.<code>, falling back to the raw code", () => {
    const t = vi.fn((key, fallback) => fallback);
    expect(warningLabel(t, "FEATURES_DROPPED")).toBe("FEATURES_DROPPED");
    expect(t).toHaveBeenCalledWith(
      "harvest.warning.FEATURES_DROPPED",
      "FEATURES_DROPPED",
    );
  });

  it("returns the translation when one exists", () => {
    const t = vi.fn(() => "Features dropped");
    expect(warningLabel(t, "FEATURES_DROPPED")).toBe("Features dropped");
  });
});

describe("harvest.warning.<CODE> translations", () => {
  const CODES = [
    "FEATURES_HIDDEN",
    "FEATURES_DROPPED",
    "OCCURRENCES_DROPPED",
    "NON_CF_STANDARD_NAMES",
    "UNKNOWN_PLATFORM_VOCABULARY",
    "DAY_COUNT_FALLBACK",
    "RECORD_COUNT_ESTIMATED",
    "DEPTH_RANGE_UNAVAILABLE",
    "PROFILE_COUNT_UNAVAILABLE",
    "TRACKS_UNAVAILABLE",
    "TRAJECTORY_DATA_INCOMPLETE",
  ];

  it.each([
    ["en", en],
    ["fr", fr],
  ])("labels every harvester warning code in %s", (_lang, translation) => {
    for (const code of CODES) {
      expect(translation[`harvest.warning.${code}`]).toBeTruthy();
    }
  });
});
