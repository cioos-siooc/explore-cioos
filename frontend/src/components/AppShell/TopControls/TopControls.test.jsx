import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import TopControls from "./TopControls.jsx";

describe("TopControls", () => {
  beforeEach(() => {
    installMockFetch();
  });

  // Same "solid primary while the thing it opens is on screen" affordance the
  // Datasets and Filters segments already carry (see .topBarButton.active) —
  // Coverage is the third peer in that row and was missing it.
  it("goes active once the coverage modal it opens is showing", async () => {
    const user = userEvent.setup();
    renderWithProviders(<TopControls />, { providers: "app" });

    const coverageButton = screen.getByTestId("topbar-coverage-button");
    expect(coverageButton).toHaveAttribute("aria-pressed", "false");
    expect(coverageButton).not.toHaveClass("active");

    await user.click(coverageButton);

    expect(coverageButton).toHaveAttribute("aria-pressed", "true");
    expect(coverageButton).toHaveClass("active");
  });
});
