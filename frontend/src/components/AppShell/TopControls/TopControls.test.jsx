import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
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

  // The toggle rides on the far edge of the Filters segment rather than
  // opening it (see styles.css' .topBarFiltersToggle) — a real button beside
  // the one that opens the modal, not a second job for that same button.
  describe("the filter-chips toggle on the Filters button", () => {
    it("folds the active-filter chips away, leaving the quick filters in the card", async () => {
      const user = userEvent.setup({ delay: null });
      renderWithProviders(<TopControls />, {
        url: "/?eovs=oxygen",
        providers: "app",
      });
      await waitFor(() =>
        expect(screen.queryAllByTestId("filter-chip-group")).toHaveLength(1),
      );
      expect(screen.getByTestId("quick-filters")).toBeInTheDocument();

      const toggle = screen.getByTestId("filter-chips-toggle");
      expect(toggle).toHaveAttribute("aria-expanded", "true");

      await user.click(toggle);

      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByTestId("quick-filters")).toBeInTheDocument();
      expect(screen.queryAllByTestId("filter-chip-group")).toHaveLength(0);

      await user.click(toggle);

      await waitFor(() =>
        expect(screen.queryAllByTestId("filter-chip-group")).toHaveLength(1),
      );
    });

    it("hides without clearing what it hides", async () => {
      const user = userEvent.setup({ delay: null });
      renderWithProviders(<TopControls />, {
        url: "/?eovs=oxygen&onlyInView=true",
        providers: "app",
      });
      await waitFor(() =>
        expect(screen.queryAllByTestId("filter-chip-group")).toHaveLength(1),
      );

      await user.click(screen.getByTestId("filter-chips-toggle"));
      await user.click(screen.getByTestId("filter-chips-toggle"));

      await waitFor(() =>
        expect(screen.queryAllByTestId("filter-chip-group")).toHaveLength(1),
      );
      expect(screen.getByTestId("quick-filter-in-view")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("leaves opening the filters modal to the other button", async () => {
      const user = userEvent.setup();
      renderWithProviders(<TopControls />, { providers: "app" });

      const filtersButton = screen.getByTestId("topbar-filters-button");
      expect(filtersButton).toHaveAttribute("aria-pressed", "false");

      await user.click(screen.getByTestId("filter-chips-toggle"));

      expect(filtersButton).toHaveAttribute("aria-pressed", "false");

      await user.click(filtersButton);

      expect(filtersButton).toHaveAttribute("aria-pressed", "true");
    });
  });
});
