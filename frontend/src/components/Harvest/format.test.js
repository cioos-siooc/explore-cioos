import { describe, it, expect } from "vitest";
import {
  hostname,
  fmtDt,
  fmtDurationS,
  fmtDurationMs,
  fmtBytes,
  datasetLink,
  displayStatus,
} from "./format.js";

describe("hostname", () => {
  it("extracts the hostname from a URL", () => {
    expect(hostname("https://erddap.ogsl.ca/erddap")).toBe("erddap.ogsl.ca");
  });

  it("returns the input unchanged when it isn't a valid URL", () => {
    expect(hostname("not a url")).toBe("not a url");
  });
});

describe("fmtDt", () => {
  it("returns an em dash for a missing value", () => {
    expect(fmtDt(null)).toBe("—");
    expect(fmtDt(undefined)).toBe("—");
  });

  it("formats a valid date/string with a year, month, day and time", () => {
    const out = fmtDt("2024-03-15T10:30:00Z");
    expect(out).toMatch(/2024/);
    expect(out).toMatch(/Mar/);
  });

  it("falls back to the raw value string for an unparseable date", () => {
    expect(fmtDt("not a date")).toBe("not a date");
  });
});

describe("fmtDurationS", () => {
  it("returns an em dash for a missing value", () => {
    expect(fmtDurationS(null)).toBe("—");
    expect(fmtDurationS(undefined)).toBe("—");
  });

  it("formats under a minute as plain seconds", () => {
    expect(fmtDurationS(45)).toBe("45s");
  });

  it("formats a minute or more as minutes and seconds", () => {
    expect(fmtDurationS(125)).toBe("2m 5s");
  });

  it("treats 0 as a real value, not missing", () => {
    expect(fmtDurationS(0)).toBe("0s");
  });
});

describe("fmtDurationMs", () => {
  it("returns an em dash for a missing value", () => {
    expect(fmtDurationMs(null)).toBe("—");
  });

  it("formats milliseconds as seconds to one decimal", () => {
    expect(fmtDurationMs(1234)).toBe("1.2s");
  });
});

describe("fmtBytes", () => {
  it("returns an em dash for a missing or non-numeric value", () => {
    expect(fmtBytes(null)).toBe("—");
    expect(fmtBytes("not a number")).toBe("—");
  });

  it("formats sub-1024 counts as bytes", () => {
    expect(fmtBytes(500)).toBe("500 B");
  });

  it("scales up through KB/MB/GB/TB", () => {
    // Under 10 units keeps one decimal (see the next test) — 2048 B is 2.0 KB.
    expect(fmtBytes(2048)).toBe("2.0 KB");
    expect(fmtBytes(15 * 1024 * 1024)).toBe("15 MB");
    expect(fmtBytes(30 * 1024 * 1024 * 1024)).toBe("30 GB");
  });

  it("keeps one decimal under 10 units, none at or above", () => {
    expect(fmtBytes(1.5 * 1024)).toBe("1.5 KB");
    expect(fmtBytes(12 * 1024)).toBe("12 KB");
  });

  it("caps at TB rather than inventing a further unit", () => {
    expect(fmtBytes(2048 * 1024 * 1024 * 1024 * 1024)).toBe("2048 TB");
  });
});

describe("datasetLink", () => {
  it("links an OBIS dataset to obis.org by its dataset id", () => {
    expect(datasetLink("https://obis.org", "abc123", "obis")).toBe(
      "https://obis.org/dataset/abc123",
    );
  });

  it("links an ERDDAP dataset to its tabledap data page", () => {
    expect(
      datasetLink("https://erddap.example.com/erddap/", "obs_270", "erddap"),
    ).toBe("https://erddap.example.com/erddap/tabledap/obs_270.html");
  });

  it("returns a safe fallback when erddapUrl can't be operated on", () => {
    expect(datasetLink(undefined, "obs_270", "erddap")).toBe("#");
  });
});

describe("displayStatus", () => {
  it("maps a hash-verified skip to 'unchanged'", () => {
    expect(
      displayStatus({ status: "skipped", reason_code: "UNCHANGED" }),
    ).toBe("unchanged");
  });

  it("leaves every other status/reason combination as-is", () => {
    expect(
      displayStatus({ status: "skipped", reason_code: "ON_SKIP_LIST" }),
    ).toBe("skipped");
    expect(displayStatus({ status: "success" })).toBe("success");
    expect(displayStatus({ status: "error" })).toBe("error");
  });
});
