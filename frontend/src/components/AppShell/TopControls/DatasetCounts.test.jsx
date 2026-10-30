import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
    await userEvent.hover(screen.getByRole("status"));
    expect(screen.getByRole("tooltip")).toHaveTextContent(
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
    await userEvent.hover(screen.getByRole("status"));
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      /^\d+ of 40 datasets shown/,
    );
  });

  // The fixture's stalest source last harvested on 2026-10-20.
  it("dates the catalogue by its stalest source's last harvest", async () => {
    renderWithProviders(<DatasetCounts />, { providers: "app" });
    const tally = screen.getByTestId("dataset-counts");
    await waitFor(() => expect(tally).toHaveTextContent(/^40 datasets$/));
    await userEvent.hover(screen.getByRole("status"));
    await waitFor(() =>
      expect(screen.getByRole("tooltip")).toHaveTextContent(
        "Data current as of October 20, 2026",
      ),
    );
  });

  it("is reachable from the keyboard", async () => {
    renderWithProviders(<DatasetCounts />, { providers: "app" });
    const tally = screen.getByTestId("dataset-counts");
    await waitFor(() => expect(tally).toHaveTextContent(/^40 datasets$/));
    await userEvent.tab();
    expect(await screen.findByRole("tooltip")).toBeInTheDocument();
  });
});
