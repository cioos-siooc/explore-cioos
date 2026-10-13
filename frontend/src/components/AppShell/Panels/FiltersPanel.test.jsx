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
});
