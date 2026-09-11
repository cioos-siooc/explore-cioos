import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../test/mockFetch.js";
import { MOBILE_WIDTH, setViewportWidth } from "../../test/viewport.js";
import pointQueryFixture from "../../../e2e/fixtures/api/pointQuery.json";

// Map.jsx is thousands of lines of imperative MapLibre/mapbox-gl-draw work —
// this branch's own convention (see src/test/stubs/maplibre.js's comment)
// treats real map behavior as e2e-only. This test is about whether the
// chrome AROUND the map (sidebar, filters, legend, counts) composes
// correctly from the provider stack, not about the map canvas itself.
vi.mock("../Map/Map.jsx", () => ({
  default: () => <div data-testid="mock-map" />,
}));

import AppShell from "./AppShell.jsx";

describe("AppShell (composition)", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("renders the full shell once the catalog and results have loaded", async () => {
    renderWithProviders(<AppShell />, { providers: "app" });
    await waitFor(() =>
      expect(screen.getByTestId("mock-map")).toBeInTheDocument(),
    );
    await waitFor(() => {
      expect(screen.getByTestId("sidebar-toggle-count")).toHaveTextContent(
        String(pointQueryFixture.length),
      );
    });
  });

  it("opens the dataset list and, from it, a dataset's own page — Sidebar, DatasetsTable, SelectionProvider and DatasetInspector working together", async () => {
    const user = userEvent.setup();
    // Phone-width default (UIProvider's breakpoint): sidebar starts collapsed,
    // so opening it here is itself part of what this test exercises.
    setViewportWidth(MOBILE_WIDTH);
    renderWithProviders(<AppShell />, { providers: "app" });
    await waitFor(() =>
      expect(screen.getByTestId("mock-map")).toBeInTheDocument(),
    );

    const toggle = screen.getByTestId("sidebar-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    await waitFor(() =>
      expect(toggle).toHaveAttribute("aria-expanded", "true"),
    );

    const cards = await screen.findAllByTestId(
      "dataset-card",
      {},
      { timeout: 3000 },
    );
    const card = cards[0];
    // The first result rendered isn't necessarily fixture[0] (the list may
    // sort) — resolve the actual first card's title instead of assuming.
    const firstCardTitle = card.querySelector(".datasetCardTitle")?.textContent;
    expect(firstCardTitle).toBeTruthy();
    await user.click(card);

    // Opening the page is a URL change (?dataset=&server=), which
    // SelectionProvider resolves back into `inspectDataset`, and the
    // DatasetInspector renders that dataset's own page from it.
    await waitFor(() => {
      expect(
        new URL(window.location.href).searchParams.get("dataset"),
      ).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
        firstCardTitle,
      );
    });
  });

  it("opening the Filters modal shows the filter panel", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppShell />, { providers: "app" });
    await waitFor(() =>
      expect(screen.getByTestId("mock-map")).toBeInTheDocument(),
    );

    const filtersButton = await screen.findByText("Filters");
    await user.click(filtersButton);
    await waitFor(() => {
      expect(
        document.querySelector(".filtersPanel, .filtersPanelBody"),
      ).toBeTruthy();
    });
  });

  it("shows the API error banner when a catalog fetch fails", async () => {
    installMockFetch();
    const realFetch = global.fetch;
    global.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/datasets")) {
        return Promise.resolve(new Response(null, { status: 500 }));
      }
      return realFetch(input, init);
    };
    renderWithProviders(<AppShell />, { providers: "app" });
    await waitFor(() => {
      expect(
        document.querySelector(".apiErrorBanner, [class*=ErrorBanner]"),
      ).toBeTruthy();
    });
  });
});
