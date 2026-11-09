import * as React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import FiltersPanel from "./FiltersPanel.jsx";

describe("FiltersPanel", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("footer states the total once when nothing is filtered out", async () => {
    renderWithProviders(<FiltersPanel />, { providers: "app" });
    const count = screen.getByTestId("filters-panel-count");
    await waitFor(() => expect(count).toHaveTextContent(/^40 datasets$/));
    expect(count).toHaveAttribute("title", "All 40 datasets shown");
  });

  it("footer splits filtered over total once something narrows the list", async () => {
    renderWithProviders(<FiltersPanel />, {
      url: "/?search=temperature",
      providers: "app",
    });
    const count = screen.getByTestId("filters-panel-count");
    await waitFor(() => expect(count).toHaveTextContent(/^\d+\/40 datasets$/));
    expect(count).toHaveAttribute(
      "title",
      expect.stringMatching(/^\d+ of 40 datasets shown$/),
    );
  });

  it("text search takes a term and where to look for it", async () => {
    const seen = {};
    function Probe() {
      const { searchText, searchIn } = useFilters();
      Object.assign(seen, { searchText, searchIn });
      return null;
    }
    const user = userEvent.setup({ delay: null });
    renderWithProviders(
      <>
        <FiltersPanel />
        <Probe />
      </>,
      { providers: "app" },
    );
    expect(screen.queryByText("Dataset title")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Text Search" }));
    await user.type(
      screen.getByPlaceholderText("Search dataset titles…"),
      "argo{Enter}",
    );
    expect(seen).toEqual({ searchText: "argo", searchIn: "titles" });

    await user.click(screen.getByTestId("text-search-all"));
    expect(seen).toEqual({ searchText: "argo", searchIn: "all" });
  });

  it("Show results is offered only where there is something to close", async () => {
    const onDone = vi.fn();
    const { unmount } = renderWithProviders(<FiltersPanel onDone={onDone} />, {
      providers: "app",
    });
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Show results" }));
    expect(onDone).toHaveBeenCalledOnce();
    unmount();

    renderWithProviders(<FiltersPanel />, { providers: "app" });
    expect(
      screen.queryByRole("button", { name: "Show results" }),
    ).not.toBeInTheDocument();
  });
});
