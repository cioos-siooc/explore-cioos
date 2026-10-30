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
function stubRoutes(overrides = {}) {
  installMockHarvestFetch({
    "/servers": SERVERS,
    "/runs/recent": RUNS,
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
});
