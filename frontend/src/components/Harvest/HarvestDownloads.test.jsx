import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import { installMockHarvestFetch } from "../../test/mockHarvestFetch.js";
import HarvestDownloads from "./HarvestDownloads.jsx";

const SUMMARY = {
  n_completed: 12,
  n_failed: 2,
  n_open: 1,
  n_stuck: 0,
  n_stalled: 0,
  last_request_at: "2024-03-01T00:00:00Z",
};
const JOBS = [
  {
    pk: 1,
    job_id: "job-1",
    time: "2024-03-01T00:00:00Z",
    status: "completed",
    duration_s: 30,
    download_size: 2048,
    error_message: null,
    n_ok: 3,
    n_failed: 0,
    n_datasets: 3,
  },
];
const DATASETS = [
  {
    dataset_id: "obs_270",
    erddap_url: "https://erddap.example.com/erddap",
    n_attempts: 5,
    n_ok: 3,
    n_failed: 2,
    n_empty: 0,
    n_ignored: 0,
    last_attempt_at: "2024-03-01T00:00:00Z",
    last_status: "FAILED",
    last_error: "500",
    last_job_id: "job-1",
    total_bytes: 2048,
  },
];

function stubRoutes(overrides = {}) {
  installMockHarvestFetch({
    "/downloads/summary": SUMMARY,
    "/downloads/recent": JOBS,
    "/downloads/datasets": DATASETS,
    ...overrides,
  });
}

describe("HarvestDownloads", () => {
  beforeEach(() => {
    stubRoutes();
  });

  it("shows the summary bar and the dataset-outcomes and jobs tables", async () => {
    renderWithProviders(<HarvestDownloads />);
    expect(await screen.findByText(/12.*completed/)).toBeInTheDocument();
    expect(screen.getByText("obs_270")).toBeInTheDocument();
    expect(screen.getAllByText(/KB/).length).toBeGreaterThan(0);
  });

  it("shows a dataset's reason text under its row when it has one", async () => {
    renderWithProviders(<HarvestDownloads />);
    await screen.findByText("obs_270");
    expect(
      screen.getByText("Could not be retrieved from its source."),
    ).toBeInTheDocument();
  });

  it("shows the stalled-queue warning only when jobs are stuck", async () => {
    stubRoutes({ "/downloads/summary": { ...SUMMARY, n_stuck: 2 } });
    renderWithProviders(<HarvestDownloads />);
    expect(
      await screen.findByText(/download request.*queued.*nothing processing/),
    ).toBeInTheDocument();
  });

  it("shows the no-datasets message when nothing has been downloaded", async () => {
    stubRoutes({ "/downloads/datasets": [] });
    renderWithProviders(<HarvestDownloads />);
    expect(
      await screen.findByText("No datasets have been downloaded yet."),
    ).toBeInTheDocument();
  });

  it("filtering by status re-fetches the datasets query with the status param", async () => {
    const { user } = renderWithProviders(<HarvestDownloads />);
    await screen.findByText("obs_270");
    stubRoutes({ "/downloads/datasets?status=FAILED": [DATASETS[0]] });
    await user.selectOptions(
      screen.getByDisplayValue("All statuses"),
      "FAILED",
    );
    await waitFor(() => {
      expect(
        new URL(window.location.href).searchParams.get("status"),
      ).toBe("FAILED");
    });
  });

  it("each download-request row links to its own job page", async () => {
    renderWithProviders(<HarvestDownloads />);
    await screen.findByText("obs_270");
    const jobLinks = document.querySelectorAll(
      'a[href="/harvest/downloads/job-1"]',
    );
    expect(jobLinks.length).toBeGreaterThan(0);
  });
});
