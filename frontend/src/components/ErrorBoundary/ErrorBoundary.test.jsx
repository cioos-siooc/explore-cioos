import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import ErrorBoundary from "./ErrorBoundary.jsx";

vi.mock("@sentry/react", () => ({ captureException: vi.fn() }));

function Bomb({ shouldThrow }) {
  if (shouldThrow) throw new Error("kaboom");
  return <div>fine</div>;
}

describe("ErrorBoundary", () => {
  it("renders its children when nothing has thrown", () => {
    render(
      <ErrorBoundary
        logoSource="/logo.png"
        errorBoundaryMessage="Something broke"
      >
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("fine")).toBeInTheDocument();
  });

  it("catches a child's render error and shows the fallback message and logo", () => {
    // React logs the caught error to the console by default; keep the test
    // output clean without hiding a real assertion failure.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    render(
      <ErrorBoundary
        logoSource="/logo.png"
        errorBoundaryMessage="Something broke"
      >
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something broke")).toBeInTheDocument();
    expect(screen.getByText("kaboom")).toBeInTheDocument();
    const logo = document.querySelector(".errorLogo");
    expect(logo).toHaveAttribute("src", "/logo.png");
    consoleError.mockRestore();
  });

  it("reports the caught error to Sentry with the component stack", async () => {
    const Sentry = await import("@sentry/react");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    render(
      <ErrorBoundary
        logoSource="/logo.png"
        errorBoundaryMessage="Something broke"
      >
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        extra: expect.objectContaining({
          componentStack: expect.any(String),
        }),
      }),
    );
    consoleError.mockRestore();
  });
});
