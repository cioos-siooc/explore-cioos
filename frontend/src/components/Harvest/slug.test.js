import { describe, it, expect } from "vitest";
import { slugify } from "./slug.js";

describe("slugify", () => {
  it("drops the scheme and replaces '.' and '/' with '-'", () => {
    expect(slugify("https://erddap.ogsl.ca/erddap")).toBe(
      "erddap-ogsl-ca-erddap",
    );
  });

  it("drops a trailing slash before replacing separators", () => {
    expect(slugify("https://erddap.example.com/erddap/")).toBe(
      "erddap-example-com-erddap",
    );
  });

  it("is case-insensitive on the scheme", () => {
    expect(slugify("HTTPS://erddap.example.com")).toBe("erddap-example-com");
  });

  it("coerces a non-string input to a string first", () => {
    expect(slugify(123)).toBe("123");
  });
});
