import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

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
const REASONS = [{ reason_code: "HTTP_ERROR", n: 4 }];
const DOWNLOADS_SUMMARY = {
  n_completed: 10,
  n_failed: 1,
  n_open: 2,
  n_stuck: 0,
  n_stalled: 0,
  last_request_at: "2024-03-02T00:00:00Z",
};

function stubRoutes(overrides = {}) {
  installMockHarvestFetch({
    "/servers": SERVERS,
    "/runs/recent": RUNS,
    "/reasons": REASONS,
    "/downloads/summary": DOWNLOADS_SUMMARY,
    ...overrides,
  });
}

describe("HarvestOverview", () => {
  beforeEach(() => {
    stubRoutes();
  });

  it("renders a server card per source, with its success/skip/error counts", async () => {
    renderWithProviders(<HarvestOverview />);
    expect(await screen.findByText("erddap.example.com")).toBeInTheDocument();
    expect(screen.getByText("✓ 40")).toBeInTheDocument();
    expect(screen.getByText("✗ 1")).toBeInTheDocument();
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

  it("shows the top-failure-reasons table", async () => {
    renderWithProviders(<HarvestOverview />);
    expect(await screen.findByText("HTTP error")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("shows the downloads summary counts and a link to the full page", async () => {
    renderWithProviders(<HarvestOverview />);
    expect(await screen.findByText(/10.*completed/)).toBeInTheDocument();
    expect(screen.getByText(/1.*failed/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View all/ })).toHaveAttribute(
      "href",
      "/harvest/downloads",
    );
  });

  it("shows a stalled-queue warning when the queue is stuck", async () => {
    stubRoutes({
      "/downloads/summary": { ...DOWNLOADS_SUMMARY, n_stuck: 3 },
    });
    renderWithProviders(<HarvestOverview />);
    expect(
      await screen.findByText(/3 download requests are queued/),
    ).toBeInTheDocument();
  });

  it("omits the stalled-queue warning when nothing is stuck", async () => {
    renderWithProviders(<HarvestOverview />);
    await screen.findByText("erddap.example.com");
    expect(
      screen.queryByText(/download request.*queued/),
    ).not.toBeInTheDocument();
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
