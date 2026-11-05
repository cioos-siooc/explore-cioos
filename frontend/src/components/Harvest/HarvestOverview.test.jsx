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
  harvested: [
    {
      erddap_url: "https://data.cioospacific.ca/erddap",
      n_datasets: 40,
      n_matched: 30,
    },
    { erddap_url: "https://obis.org", n_datasets: 10, n_matched: 1 },
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
    const title = await screen.findByText("Latest harvest outcome");
    expect(
      within(title.closest("div")).getByRole("img", {
        name: "50 of 59 datasets harvested in the last run",
      }),
    ).toBeInTheDocument();
    const bars = screen
      .getByText("Why datasets were not harvested")
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

  it("shows how many of each source's harvested datasets are in the catalogue", async () => {
    renderWithProviders(<HarvestOverview />);
    expect(
      await screen.findByText("Harvested datasets with a CKAN record"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "31 of 50 harvested datasets linked to a CKAN record",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("62%")).toBeInTheDocument();
    const erddap = screen.getByText("30 / 40 (75%)").closest("li");
    expect(
      within(erddap).getByText("data.cioospacific.ca"),
    ).toBeInTheDocument();
    expect(erddap).toHaveAttribute("title", "10 datasets not in the catalogue");
    const obis = screen.getByText("1 / 10 (10%)").closest("li");
    expect(within(obis).getByText("obis.org")).toBeInTheDocument();
    expect(obis).toHaveAttribute("title", "9 datasets not in the catalogue");
  });

  it("splits the harvested datasets missing from CKAN by source", async () => {
    renderWithProviders(<HarvestOverview />);
    const bar = await screen.findByRole("img", {
      name: "19 harvested datasets are not in any CKAN catalogue",
    });
    const legend = bar.parentElement.querySelector("ul");
    const rows = within(legend)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(rows).toEqual(["data.cioospacific.ca10 · 53%", "obis.org9 · 47%"]);
  });

  it("folds the sources past the seventh into Other", async () => {
    const harvested = Array.from({ length: 9 }, (_, i) => ({
      erddap_url: `https://s${i}.example.org/erddap`,
      n_datasets: 20 - i,
      n_matched: 0,
    }));
    stubRoutes({ "/ckan-coverage": { ...CKAN_COVERAGE, harvested } });
    renderWithProviders(<HarvestOverview />);
    const bar = await screen.findByRole("img", {
      name: "144 harvested datasets are not in any CKAN catalogue",
    });
    const rows = within(bar.parentElement.querySelector("ul")).getAllByRole(
      "listitem",
    );
    expect(rows).toHaveLength(8);
    expect(rows[7]).toHaveTextContent("Other sources25 · 17%");
  });

  it("holds both CKAN sections with a spinner while the coverage loads", async () => {
    const mockFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (input) =>
      String(input).endsWith("/ckan-coverage")
        ? new Promise(() => {})
        : mockFetch(input),
    );
    renderWithProviders(<HarvestOverview />);
    expect(
      await screen.findByText("Harvested datasets with a CKAN record"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("CKAN records with harvested data"),
    ).toBeInTheDocument();
    const loading = screen.getAllByText("Loading catalogue coverage…");
    expect(loading).toHaveLength(2);
    for (const el of loading)
      expect(el.closest('[role="status"]')).toBeInTheDocument();
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
