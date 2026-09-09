import * as React from "react";
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import ActivityProvider, {
  useActivityTask,
} from "../../state/activity/ActivityProvider.jsx";
import CioosLogo from "./CioosLogo.jsx";

describe("CioosLogo", () => {
  it("renders the brand name (and full name only in stacked layout)", () => {
    renderWithProviders(<CioosLogo layout="stacked" />);
    expect(screen.getByText("CIOOS")).toBeInTheDocument();
    expect(
      screen.getByText("Canadian Integrated Ocean Observing System"),
    ).toBeInTheDocument();
  });

  it("omits the full name in inline layout", () => {
    renderWithProviders(<CioosLogo layout="inline" />);
    expect(screen.getByText("CIOOS")).toBeInTheDocument();
    expect(
      screen.queryByText("Canadian Integrated Ocean Observing System"),
    ).not.toBeInTheDocument();
  });

  it("marks itself idle when inline and nothing is announced", () => {
    const { container } = renderWithProviders(<CioosLogo layout="inline" />);
    expect(container.querySelector(".cioosLogo")).toHaveClass("cioosLogo-idle");
  });

  it("is never idle in stacked layout, even with nothing announced", () => {
    const { container } = renderWithProviders(<CioosLogo layout="stacked" />);
    expect(container.querySelector(".cioosLogo")).not.toHaveClass(
      "cioosLogo-idle",
    );
  });

  it("drops the idle class (inline) once something is announced busy", async () => {
    function BusyTask() {
      useActivityTask("legendLoadingText", true);
      return null;
    }
    const { container } = renderWithProviders(
      <ActivityProvider>
        <BusyTask />
        <CioosLogo layout="inline" />
      </ActivityProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 300)); // past ANNOUNCE_AFTER_MS
    expect(container.querySelector(".cioosLogo")).not.toHaveClass(
      "cioosLogo-idle",
    );
  });
});
