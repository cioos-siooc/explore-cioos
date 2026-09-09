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
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("boom");

    reportError("pointQuery failed", error);

    expect(consoleError).toHaveBeenCalledWith("pointQuery failed:", error);
    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { context: "pointQuery failed" },
    });
    consoleError.mockRestore();
  });

  it("silently ignores an AbortError — expected control flow, not a failure", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const abortError = new DOMException("aborted", "AbortError");

    reportError("legend fetch failed", abortError);

    expect(consoleError).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
