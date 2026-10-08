import { describe, it, expect } from "vitest";

import { aliasVariants } from "./searchAliases.js";

describe("aliasVariants", () => {
  it("reads an acronym as its full names, in both languages", () => {
    expect(aliasVariants("OTN")).toEqual(
      expect.arrayContaining([
        "otn",
        "ocean tracking network",
        "reseau de suivi des oceans",
      ]),
    );
  });

  it("reads a full name as its acronyms", () => {
    expect(aliasVariants("Ocean Tracking Network")).toContain("otn");
  });

  it("reads the English acronym as the French one", () => {
    expect(aliasVariants("SLGO")).toContain("ogsl");
  });

  it("ignores accents and case", () => {
    expect(aliasVariants("PÊCHES ET OCÉANS CANADA")).toContain("dfo");
  });

  it("swaps the alias inside a longer text", () => {
    expect(aliasVariants("otn moorings")).toContain(
      "ocean tracking network moorings",
    );
  });

  it("matches whole words only", () => {
    expect(aliasVariants("cotnet")).toEqual(["cotnet"]);
  });
});
