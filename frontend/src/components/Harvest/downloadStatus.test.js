import { describe, it, expect } from "vitest";
import {
  datasetBadgeClass,
  jobBadgeClass,
  datasetReason,
} from "./downloadStatus.js";

describe("datasetBadgeClass", () => {
  it("maps every known downloader status to its badge class", () => {
    expect(datasetBadgeClass("COMPLETED")).toBe("success");
    expect(datasetBadgeClass("PARTIAL")).toBe("skipped");
    expect(datasetBadgeClass("FAILED")).toBe("error");
    expect(datasetBadgeClass("EMPTY")).toBe("unchanged");
    expect(datasetBadgeClass("IGNORED")).toBe("skipped");
  });

  it("falls back to 'skipped' for an unrecognized status", () => {
    expect(datasetBadgeClass("SOMETHING_NEW")).toBe("skipped");
  });
});

describe("jobBadgeClass", () => {
  it("maps every known job status to its badge class", () => {
    expect(jobBadgeClass("completed")).toBe("success");
    expect(jobBadgeClass("failed")).toBe("error");
    expect(jobBadgeClass("no-data")).toBe("unchanged");
    expect(jobBadgeClass("over-limit")).toBe("skipped");
    expect(jobBadgeClass("downloading")).toBe("running");
    expect(jobBadgeClass("open")).toBe("running");
  });

  it("falls back to 'skipped' for an unrecognized status", () => {
    expect(jobBadgeClass("something-new")).toBe("skipped");
  });
});

describe("datasetReason", () => {
  const t = (key) => key;

  it("prefers the ERDDAP error text when present", () => {
    expect(
      datasetReason(t, { erddap_error: "500 Internal Server Error" }),
    ).toBe("500 Internal Server Error");
  });

  it("maps each terminal status to its own reason key", () => {
    expect(datasetReason(t, { status: "FAILED" })).toBe(
      "harvest.downloads.reason.failed",
    );
    expect(datasetReason(t, { status: "EMPTY" })).toBe(
      "harvest.downloads.reason.empty",
    );
    expect(datasetReason(t, { status: "IGNORED" })).toBe(
      "harvest.downloads.reason.ignored",
    );
    expect(datasetReason(t, { status: "PARTIAL" })).toBe(
      "harvest.downloads.reason.partial",
    );
  });

  it("reads last_status when status is absent (the dataset-outcomes row shape)", () => {
    expect(datasetReason(t, { last_status: "FAILED" })).toBe(
      "harvest.downloads.reason.failed",
    );
  });

  it("returns null for a successful/unrecognized status", () => {
    expect(datasetReason(t, { status: "COMPLETED" })).toBeNull();
    expect(datasetReason(t, {})).toBeNull();
  });
});
