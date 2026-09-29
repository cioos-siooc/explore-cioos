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

  it("states the selection count inside the Download button, not beside it", async () => {
    renderWithProviders(<AppShell />, { providers: "app" });
    const footer = await screen.findByTestId("sidebar-footer");
    const button = screen.getByRole("button", { name: /Download/ });
    expect(button).toHaveTextContent("0 selected");
    expect(button).toBeDisabled();
    expect(footer.textContent.match(/selected/g)).toHaveLength(1);
  });

  it("opens the dataset list and, from it, a dataset's own page — Sidebar, DatasetsTable, SelectionProvider and DatasetInspector working together", async () => {
    const user = userEvent.setup();
    // Phone-width default (UIProvider's breakpoint): sidebar starts collapsed,
    // so opening it here — from the top bar, the only control that opens it;
    // the card's own chevron just dismisses it — is itself part of what this
    // test exercises.
    setViewportWidth(MOBILE_WIDTH);
    // A returning visitor, so the intro isn't sitting over the page (jsdom
    // doesn't stop clicks behind it) and its own headings stay out of the query
    // below.
    window.localStorage.setItem("cde.introSeen", "true");
    renderWithProviders(<AppShell />, { providers: "app" });
    await waitFor(() =>
      expect(screen.getByTestId("mock-map")).toBeInTheDocument(),
    );

    const panel = screen.getByTestId("sidebar-datasets");
    expect(panel).toHaveAttribute("data-expanded", "false");
    await user.click(screen.getByTestId("topbar-datasets-button"));
    await waitFor(() => expect(panel).toHaveAttribute("data-expanded", "true"));

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

  it("closes a dataset page and the sidebar from the banner's close button", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("cde.introSeen", "true");
    renderWithProviders(<AppShell />, {
      providers: "app",
      url: `/?dataset=${pointQueryFixture[0].dataset_id}`,
    });
    await screen.findByTestId("sidebar-back", {}, { timeout: 3000 });
    await user.click(screen.getByTestId("sidebar-close-dataset"));
    expect(screen.getByTestId("sidebar-datasets")).toHaveAttribute(
      "data-expanded",
      "false",
    );
    await waitFor(() =>
      expect(
        new URL(window.location.href).searchParams.get("dataset"),
      ).toBeNull(),
    );
    expect(screen.queryByTestId("dataset-map-card")).toBeNull();
  });

  describe("a minimized dataset page", () => {
    // Collapsing the sidebar on a dataset page used to leave the map keyed to
    // that dataset with no way back to its page: the top bar's Datasets button
    // dropped the dataset on the way to the list.
    async function minimize() {
      const user = userEvent.setup();
      window.localStorage.setItem("cde.introSeen", "true");
      const row = pointQueryFixture[0];
      renderWithProviders(<AppShell />, {
        providers: "app",
        url: `/?dataset=${row.dataset_id}`,
      });
      await screen.findByTestId("sidebar-back", {}, { timeout: 3000 });
      await user.click(screen.getByTestId("sidebar-collapse"));
      const card = await screen.findByTestId("dataset-map-card");
      return { user, row, card };
    }

    it("stands in for the page on the map, named by its dataset", async () => {
      const { row, card } = await minimize();
      expect(screen.getByTestId("sidebar-datasets")).toHaveAttribute(
        "data-expanded",
        "false",
      );
      expect(card).toHaveAccessibleName(row.title);
    });

    it.each([
      ["the card's Details button", "dataset-map-card-details"],
      ["the top bar's Datasets button", "topbar-datasets-button"],
    ])("comes back as it was left from %s", async (_, testId) => {
      const { user } = await minimize();
      await user.click(screen.getByTestId(testId));
      expect(screen.getByTestId("sidebar-datasets")).toHaveAttribute(
        "data-expanded",
        "true",
      );
      expect(screen.getByTestId("sidebar-back")).toBeInTheDocument();
      expect(screen.queryByTestId("dataset-map-card")).toBeNull();
    });

    it("is left for good from the card's close button", async () => {
      const { user } = await minimize();
      await user.click(screen.getByTestId("dataset-map-card-close"));
      expect(screen.queryByTestId("dataset-map-card")).toBeNull();
      await waitFor(() =>
        expect(
          new URL(window.location.href).searchParams.get("dataset"),
        ).toBeNull(),
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

  it("opens the selection help modal from the sidebar footer's hint", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppShell />, { providers: "app" });
    await waitFor(() =>
      expect(screen.getByTestId("mock-map")).toBeInTheDocument(),
    );

    expect(screen.queryByTestId("selection-help-modal")).toBeNull();
    await user.click(screen.getByTestId("sidebar-selection-help"));
    expect(
      await screen.findByTestId("selection-help-modal"),
    ).toBeInTheDocument();
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
