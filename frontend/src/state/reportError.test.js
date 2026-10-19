import { describe, it, expect, vi, afterEach } from "vitest";

// vi.spyOn can't redefine an ESM named export in this setup (Vitest 4 +
// Node's real ESM loader — the module namespace isn't configurable); mock
// the module itself instead.
vi.mock("@sentry/react", () => ({ captureException: vi.fn() }));

import * as Sentry from "@sentry/react";
import reportError from "./reportError.js";

afterEach(() => vi.clearAllMocks());

describe("reportError", () => {
  it("logs and forwards a real error to Sentry, tagged with its context", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const error = new Error("boom");

    reportError("pointQuery failed", error);

    expect(consoleError).toHaveBeenCalledWith("pointQuery failed:", error);
    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { context: "pointQuery failed" },
    });
    consoleError.mockRestore();
  });

  it("silently ignores an AbortError — expected control flow, not a failure", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const abortError = new DOMException("aborted", "AbortError");

    reportError("legend fetch failed", abortError);

    expect(consoleError).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it.each([
    "Failed to fetch (explore.dev.cioos.ca)",
    "NetworkError when attempting to fetch resource.",
    "Load failed",
  ])(
    "groups a network failure (%s) into one warning across call sites",
    (message) => {
      const consoleWarn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});
      const error = new TypeError(message);

      reportError("legend fetch failed", error);

      expect(consoleWarn).toHaveBeenCalledWith("legend fetch failed:", error);
      expect(Sentry.captureException).toHaveBeenCalledWith(error, {
        level: "warning",
        fingerprint: ["fetch-network-failure"],
        tags: { context: "legend fetch failed" },
      });
      consoleWarn.mockRestore();
    },
  );

  it("still reports an unrelated TypeError as an error", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const error = new TypeError("x is undefined");

    reportError("pointQuery failed", error);

    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { context: "pointQuery failed" },
    });
    consoleError.mockRestore();
  });
});
