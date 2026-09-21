import * as React from "react";
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import HarvestRealtimeBadge from "./HarvestRealtimeBadge.jsx";

describe("HarvestRealtimeBadge", () => {
  it("renders nothing when the dataset isn't realtime", () => {
    const { container } = renderWithProviders(
      <HarvestRealtimeBadge isRealtime={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows 'Real-time' with its explanatory tooltip when the dataset is realtime", () => {
    renderWithProviders(<HarvestRealtimeBadge isRealtime />);
    const badge = screen.getByText("Real-time");
    expect(badge).toHaveAttribute(
      "title",
      "This dataset was still producing data as of its last harvest — the same signal as the map's Real-time badge.",
    );
  });
});
