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
  erddap_servers: [
    { erddap_url: "https://data.cioospacific.ca/erddap", n_records: 55 },
    { erddap_url: "https://erddap.example.org/erddap", n_records: 15 },
  ],
  n_linked_stale: 0,
  sources: [
    {
      source: "CIOOS Pacific",
      n_records: 300,
      n_linked: 90,
      n_erddap: 60,
      n_obis: 35,
      erddap_servers: [
        { erddap_url: "https://data.cioospacific.ca/erddap", n_records: 50 },
        { erddap_url: "https://erddap.example.org/erddap", n_records: 10 },
      ],
    },
    {
      source: null,
      n_records: 100,
      n_linked: 10,
      n_erddap: 10,
      n_obis: 0,
      erddap_servers: [],
    },
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
    expect(
      within(pacific).getByRole("img", {
        name: "data.cioospacific.ca: 50, erddap.example.org: 10, OBIS: 30, No harvested data: 210",
      }),
    ).toBeInTheDocument();
    const unknown = screen.getByText("Unknown source").closest("li");
    expect(within(unknown).getByText("10 / 100 (10%)")).toBeInTheDocument();
    expect(
      screen.queryByText(/no longer in the catalogue/),
    ).not.toBeInTheDocument();
  });

  it("splits each catalogue's ERDDAP records by server, linking each", async () => {
    renderWithProviders(<HarvestOverview />);
    const pacific = (await screen.findByText("CIOOS Pacific")).closest("li");
    const legend = within(pacific).getByRole("list", { name: "Data from" });
    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["data.cioospacific.ca50", "erddap.example.org10", "OBIS30"]);
    expect(
      within(legend).getByRole("link", { name: "data.cioospacific.ca" }),
    ).toHaveAttribute("href", "/harvest/server/data-cioospacific-ca-erddap");
    expect(
      within(legend).queryByRole("link", { name: "OBIS" }),
    ).not.toBeInTheDocument();
  });

  it("folds a catalogue's servers past the third into one segment", async () => {
    const erddap_servers = Array.from({ length: 6 }, (_, i) => ({
      erddap_url: `https://s${i}.example.org/erddap`,
      n_records: 10 - i,
    }));
    stubRoutes({
      "/ckan-coverage": {
        ...CKAN_COVERAGE,
        sources: [{ ...CKAN_COVERAGE.sources[1], erddap_servers }],
      },
    });
    renderWithProviders(<HarvestOverview />);
    const row = (await screen.findByText("Unknown source")).closest("li");
    const items = within(
      within(row).getByRole("list", { name: "Data from" }),
    ).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "s0.example.org10",
      "s1.example.org9",
      "s2.example.org8",
      "3 other ERDDAP servers18",
    ]);
    expect(items[3]).toHaveAttribute(
      "title",
      "s3.example.org: 7\ns4.example.org: 6\ns5.example.org: 5",
    );
  });

  it("keeps the CKAN columns on top and the harvest outcome above the sources", async () => {
    renderWithProviders(<HarvestOverview />);
    const metadata = await screen.findByRole("region", { name: "Metadata" });
    const data = screen.getByRole("region", { name: "Data" });
    expect(
      await within(metadata).findByRole("img", {
        name: "100 of 400 catalogue records linked to a harvested dataset",
      }),
    ).toBeInTheDocument();
    expect(
      within(data).getByRole("img", {
        name: "31 of 50 harvested datasets linked to a CKAN record",
      }),
    ).toBeInTheDocument();
    const outcome = await screen.findByText("Latest harvest outcome");
    const sources = screen.getByRole("heading", { name: "Sources" });
    expect(data.contains(outcome)).toBe(false);
    expect(
      data.compareDocumentPosition(outcome) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      outcome.compareDocumentPosition(sources) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("splits the whole catalogue's records by ERDDAP server and OBIS", async () => {
    renderWithProviders(<HarvestOverview />);
    const metadata = await screen.findByRole("region", { name: "Metadata" });
    const legend = (
      await within(metadata).findAllByRole("list", { name: "Data from" })
    )[0];
    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([
      "data.cioospacific.ca55",
      "erddap.example.org15",
      "OBIS30",
      "No harvested data300",
    ]);
  });

  it("shows how many of each source's harvested datasets are in the catalogue", async () => {
    renderWithProviders(<HarvestOverview />);
    expect(
      await screen.findByRole("img", {
        name: "31 of 50 harvested datasets linked to a CKAN record",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Harvested datasets with a CKAN record"),
    ).toBeInTheDocument();
    expect(screen.getByText("62%")).toBeInTheDocument();
    const erddap = screen.getByText("30 / 40 (75%)").closest("li");
    expect(
      within(erddap).getByText("data.cioospacific.ca"),
    ).toBeInTheDocument();
    expect(
      within(erddap).getByText("10 datasets not in the catalogue"),
    ).toBeInTheDocument();
    const obis = screen.getByText("1 / 10 (10%)").closest("li");
    expect(within(obis).getByText("obis.org")).toBeInTheDocument();
    expect(
      within(obis).getByText("9 datasets not in the catalogue"),
    ).toBeInTheDocument();
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
