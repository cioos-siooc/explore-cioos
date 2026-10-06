import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import DatasetCounts from "./DatasetCounts.jsx";

describe("DatasetCounts", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("states the total once when nothing is filtered out", async () => {
    renderWithProviders(<DatasetCounts />, { providers: "app" });
    const tally = screen.getByTestId("dataset-counts");
    await waitFor(() => expect(tally).toHaveTextContent(/^40 datasets$/));
    expect(screen.getByRole("status")).toHaveAttribute(
      "title",
      "All 40 datasets shown",
    );
  });

  it("splits filtered over total once something narrows the list", async () => {
    renderWithProviders(<DatasetCounts />, {
      url: "/?search=temperature",
      providers: "app",
    });
    const tally = screen.getByTestId("dataset-counts");
    await waitFor(() => expect(tally).toHaveTextContent(/\/40 datasets$/));
    expect(tally).not.toHaveTextContent(/^40\/40/);
    expect(screen.getByRole("status")).toHaveAttribute(
      "title",
      expect.stringMatching(/^\d+ of 40 datasets shown$/),
    );
  });
});
