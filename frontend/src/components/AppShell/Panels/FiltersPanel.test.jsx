import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import FiltersPanel from "./FiltersPanel.jsx";

describe("FiltersPanel", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("names the map's own quick-filters menu among the how-to steps shown before any filter is open", async () => {
    renderWithProviders(<FiltersPanel />, { providers: "app" });
    await waitFor(() =>
      expect(screen.getByTestId("filters-panel")).toBeInTheDocument(),
    );
    expect(screen.getByText(/next to Filters on the map/)).toBeInTheDocument();
  });
});
