import { describe, it, expect } from "vitest";

import {
  platformCategory,
  platformColor,
  platformLabel,
} from "./platformVocab.js";

describe("platformVocab", () => {
  it("puts a term under its top-level L06 category", () => {
    expect(platformCategory("diver")).toBe("organism");
    expect(platformCategory("sub-surface gliders")).toBe("submersible");
    expect(platformCategory("organism")).toBe("organism");
  });

  it("colours every term like its category", () => {
    expect(platformColor("diver")).toBe(platformColor("organism"));
    expect(platformColor("sub-surface gliders")).toBe(
      platformColor("submersible"),
    );
    expect(platformColor("diver")).not.toBe(platformColor("unknown"));
  });

  it("treats a term outside the vocabulary as its own uncoloured category", () => {
    expect(platformCategory("argo")).toBe("argo");
    expect(platformColor("argo")).toBe(platformColor("unknown"));
    expect(platformLabel("argo")).toBe("Argo");
  });

  it("labels a term in either language", () => {
    expect(platformLabel("diver", "en")).toBe("Diver");
    expect(platformLabel("diver", "fr-CA")).toBe("Plongeur");
    expect(platformLabel(undefined)).toBeUndefined();
  });
});
