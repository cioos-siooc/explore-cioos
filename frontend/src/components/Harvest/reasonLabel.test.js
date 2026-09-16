import { describe, it, expect, vi } from "vitest";
import reasonLabel from "./reasonLabel.js";

describe("reasonLabel", () => {
  it("returns an empty string without a code", () => {
    const t = vi.fn();
    expect(reasonLabel(t, undefined)).toBe("");
    expect(t).not.toHaveBeenCalled();
  });

  it("looks the code up under harvest.reason.<code>, falling back to the raw code", () => {
    const t = vi.fn((key, fallback) => fallback);
    expect(reasonLabel(t, "UNCHANGED")).toBe("UNCHANGED");
    expect(t).toHaveBeenCalledWith("harvest.reason.UNCHANGED", "UNCHANGED");
  });

  it("returns the translation when one exists", () => {
    const t = vi.fn(() => "Unchanged");
    expect(reasonLabel(t, "UNCHANGED")).toBe("Unchanged");
  });
});
