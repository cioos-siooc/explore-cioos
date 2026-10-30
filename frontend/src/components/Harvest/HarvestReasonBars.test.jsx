import * as React from "react";
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import HarvestReasonBars from "./HarvestReasonBars.jsx";

describe("HarvestReasonBars", () => {
  it("draws each reason's bar relative to the largest", () => {
    renderWithProviders(
      <HarvestReasonBars
        failures={[
          { status: "error", reason_code: "HTTP_ERROR", n: 4 },
          { status: "skipped", reason_code: "ON_SKIP_LIST", n: 1 },
        ]}
      />,
    );
    const bars = document.querySelectorAll(".harvest-bars-bar");
    expect(bars[0]).toHaveStyle({ width: "100%" });
    expect(bars[1]).toHaveStyle({ width: "25%" });
    expect(screen.getByText("HTTP error")).toBeInTheDocument();
  });

  it("greys out ingest-disabled skips", () => {
    renderWithProviders(
      <HarvestReasonBars
        failures={[
          { status: "skipped", reason_code: "INGEST_FLAG_FALSE", n: 2 },
        ]}
      />,
    );
    expect(screen.getByRole("listitem")).toHaveClass("harvest-bars-disabled");
  });

  it("renders nothing without failures", () => {
    const { container } = renderWithProviders(
      <HarvestReasonBars failures={[]} />,
    );
    expect(container.querySelector(".harvest-bars")).toBeNull();
  });
});
