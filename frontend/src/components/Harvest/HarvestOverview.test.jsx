import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import { installMockHarvestFetch } from "../../test/mockHarvestFetch.js";
import HarvestOverview from "./HarvestOverview.jsx";

const SERVERS = [
  {
    erddap_url: "https://erddap.example.com/erddap",
    n_success: 40,
    n_skipped: 2,
    n_error: 1,
    last_attempted_at: "2024-03-01T00:00:00Z",
    last_success_at: "2024-02-28T00:00:00Z",
  },
];
const RUNS = [
  {
    run_id: "11111111-1111-1111-1111-111111111111",
    started_at: "2024-03-01T00:00:00Z",
    status: "success",
    duration_s: 90,
    git_sha: "abcdef0123456",
    scope: "full",
    triggered_source: null,
    triggered_by: null,
    error_message: null,
    n_success: 40,
    n_unchanged: 3,
    n_skipped: 2,
    n_error: 1,
    n_total: 46,
  },
];
const CKAN_COVERAGE = {
  n_ckan_records: 400,
  n_linked: 100,
  n_erddap: 70,
  n_obis: 35,
  n_linked_stale: 0,
  sources: [
    {
      source: "CIOOS Pacific",
      n_records: 300,
      n_linked: 90,
      n_erddap: 60,
      n_obis: 35,
    },
    { source: null, n_records: 100, n_linked: 10, n_erddap: 10, n_obis: 0 },
  ],
};
function stubRoutes(overrides = {}) {
  installMockHarvestFetch({
    "/servers": SERVERS,
    "/runs/recent": RUNS,
    "/ckan-coverage": CKAN_COVERAGE,
    ...overrides,
  });
}

describe("HarvestOverview", () => {
  beforeEach(() => {
    stubRoutes();
  });

  it("renders a server card per source, charting its harvested and failed datasets", async () => {
    renderWithProviders(<HarvestOverview />);
    const host = await screen.findByText("erddap.example.com");
    expect(
      within(host.closest("a")).getByRole("img", {
        name: "40 of 43 datasets harvested in the last run",
      }),
    ).toBeInTheDocument();
  });

  it("splits a server's failures by reason when the API reports them", async () => {
    stubRoutes({
      "/servers": [
        {
          ...SERVERS[0],
          reasons: [{ status: "error", reason_code: "HTTP_ERROR", n: 3 }],
        },
      ],
    });
    renderWithProviders(<HarvestOverview />);
    const host = await screen.findByText("erddap.example.com");
    expect(within(host.closest("a")).getByRole("list")).toHaveTextContent(
      "HTTP error3",
    );
  });

  it("shows when each server last harvested successfully", async () => {
    renderWithProviders(<HarvestOverview />);
    expect(await screen.findByText(/Last success:/)).toBeInTheDocument();
  });

  it("says so when a server has never harvested successfully", async () => {
    stubRoutes({ "/servers": [{ ...SERVERS[0], last_success_at: null }] });
    renderWithProviders(<HarvestOverview />);
    expect(
      await screen.findByText("No successful run on record"),
    ).toBeInTheDocument();
  });

  it("shows the recent-runs table with status and totals", async () => {
    renderWithProviders(<HarvestOverview />);
    await waitFor(() => {
      expect(screen.getByText("abcdef0")).toBeInTheDocument();
    });
    expect(screen.getByText("success")).toBeInTheDocument();
    expect(screen.getByText("46")).toBeInTheDocument();
  });

  it("charts the whole catalogue and ranks its failure reasons", async () => {
    stubRoutes({
      "/servers": [
        {
          ...SERVERS[0],
          reasons: [{ status: "error", reason_code: "HTTP_ERROR", n: 3 }],
        },
        {
          ...SERVERS[0],
          erddap_url: "https://other.example.com/erddap",
          n_success: 10,
          reasons: [
            { status: "error", reason_code: "HTTP_ERROR", n: 2 },
            { status: "skipped", reason_code: "ON_SKIP_LIST", n: 4 },
          ],
        },
      ],
    });
    renderWithProviders(<HarvestOverview />);
    const title = await screen.findByText("Last run, all sources");
    expect(
      within(title.closest("div")).getByRole("img", {
        name: "50 of 59 datasets harvested in the last run",
      }),
    ).toBeInTheDocument();
    const bars = screen
      .getByText("Failure reasons")
      .parentElement.querySelectorAll(".harvest-bars li");
    expect([...bars].map((b) => b.textContent)).toEqual([
      "HTTP errorerror5",
      "On skip listskipped4",
    ]);
  });

  it("links each server card to its /harvest/server/<slug> page", async () => {
    renderWithProviders(<HarvestOverview />);
    const card = await screen.findByText("erddap.example.com");
    expect(card.closest("a")).toHaveAttribute(
      "href",
      "/harvest/server/erddap-example-com-erddap",
    );
  });

  it("shows the share of CKAN catalogue records linked to a harvested dataset", async () => {
    renderWithProviders(<HarvestOverview />);
    expect(await screen.findByText("25%")).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "100 of 400 catalogue records linked to a harvested dataset",
      }),
    ).toBeInTheDocument();
  });

  it("keeps the linked count but drops the share when the catalogue total is unavailable", async () => {
    stubRoutes({
      "/ckan-coverage": {
        ...CKAN_COVERAGE,
        n_ckan_records: null,
        n_linked_stale: null,
        sources: null,
      },
    });
    renderWithProviders(<HarvestOverview />);
    expect(
      await screen.findByText(
        "100 catalogue records linked to a harvested dataset (catalogue total unavailable)",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("25%")).not.toBeInTheDocument();
  });

  it("splits the linked records by the catalogue each was harvested from", async () => {
    renderWithProviders(<HarvestOverview />);
    const pacific = (await screen.findByText("CIOOS Pacific")).closest("li");
    expect(within(pacific).getByText("90 / 300 (30%)")).toBeInTheDocument();
    expect(pacific).toHaveAttribute(
      "title",
      "60 linked through ERDDAP, 35 through OBIS",
    );
    const unknown = screen.getByText("Unknown source").closest("li");
    expect(within(unknown).getByText("10 / 100 (10%)")).toBeInTheDocument();
    expect(
      screen.queryByText(/no longer in the catalogue/),
    ).not.toBeInTheDocument();
  });

  it("says how many linked records the catalogue has since dropped", async () => {
    stubRoutes({ "/ckan-coverage": { ...CKAN_COVERAGE, n_linked_stale: 3 } });
    renderWithProviders(<HarvestOverview />);
    expect(
      await screen.findByText(
        "3 linked records are no longer in the catalogue and are left out.",
      ),
    ).toBeInTheDocument();
  });
});
