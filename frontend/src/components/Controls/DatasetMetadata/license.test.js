import { describe, it, expect } from "vitest";

import { licenseLabel, licenseText } from "./license.js";

describe("licenseLabel", () => {
  it.each([
    [{ url: "https://creativecommons.org/licenses/by/4.0/" }, "CC BY 4.0"],
    [
      { url: "https://creativecommons.org/licenses/by-nc-sa/4.0" },
      "CC BY-NC-SA 4.0",
    ],
    [{ url: "https://creativecommons.org/publicdomain/zero/1.0/" }, "CC0"],
    [{ title: "Creative Commons Attribution 4.0" }, "CC BY 4.0"],
    [
      {
        title:
          "Creative Commons Attribution 4.0 International license CC-BY 4.0",
      },
      "CC BY 4.0",
    ],
    [
      {
        title:
          "This work is licensed under a  Creative Commons Attribution (CC-BY 4.0) License",
      },
      "CC BY 4.0",
    ],
    [
      { title: "Creative Commons Attribution-NonCommercial 4.0 International" },
      "CC BY-NC 4.0",
    ],
    [{ title: "CC-BY-4.0" }, "CC BY 4.0"],
    [{ title: "government-open-license-canada" }, "OGL Canada"],
    [{ title: "Open Government Licence - Canada" }, "OGL Canada"],
    [{ title: "Use freely, cite the source" }, "Use freely, cite the source"],
    [
      {
        title:
          "rights: 'http://data.gc.ca/eng/open-government-licence-canada &amp; http://www.canadensys.net/norms'",
      },
      "OGL Canada",
    ],
    [{ url: "https://example.org/licence" }, undefined],
    [
      {
        title:
          "The data may be used and redistributed for free but is not intended\nfor legal use.",
      },
      undefined,
    ],
  ])("%j -> %s", (license, label) => {
    expect(licenseLabel(license)).toBe(label);
  });
});

describe("licenseText", () => {
  it("decodes the entities a double-escaped source leaves behind", () => {
    expect(licenseText("A &amp; B &lt;c&gt;")).toBe("A & B <c>");
  });
});
