import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { Routes, Route } from "react-router-dom";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import { installMockHarvestFetch } from "../../test/mockHarvestFetch.js";
import HarvestRun from "./HarvestRun.jsx";

const RUN_ID = "11111111-1111-1111-1111-111111111111";

const RUN = {
  run_id: RUN_ID,
  started_at: "2024-03-01T00:00:00Z",
  finished_at: "2024-03-01T00:01:30Z",
  duration_s: 90,
  git_sha: "abcdef0123456",
  status: "success",
  error_message: null,
  scope: "full",
  triggered_by: "scheduler",
};

const ATTEMPTS = [
  {
    erddap_url: "https://erddap.example.com/erddap",
    dataset_id: "obs_270",
    status: "success",
    reason_code: null,
    error_message: null,
    duration_ms: 1000,
  },
  {
    erddap_url: "https://erddap.example.com/erddap",
    dataset_id: "obs_512",
    status: "skipped",
    reason_code: "UNCHANGED",
    error_message: null,
    duration_ms: 200,
  },
  {
    erddap_url: "https://erddap.example.com/erddap",
    dataset_id: "obs_999",
    status: "error",
    reason_code: "HTTP_ERROR",
    error_message: "connection refused",
    duration_ms: 50,
  },
];

function renderRun(runId = RUN_ID) {
  return renderWithProviders(
    <Routes>
      <Route path="/harvest/run/:runId" element={<HarvestRun />} />
    </Routes>,
    { url: `/harvest/run/${runId}` },
  );
}

describe("HarvestRun", () => {
  it("shows the run meta and status while loading, then the attempts table", async () => {
    installMockHarvestFetch({
      [`/runs/${RUN_ID}`]: { run: RUN, attempts: ATTEMPTS },
    });
    renderRun();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(await screen.findByText("abcdef0")).toBeInTheDocument();
    expect(screen.getByText("scheduler")).toBeInTheDocument();
    expect(screen.getByText("obs_270")).toBeInTheDocument();
  });

  it("normalizes an UNCHANGED skip to 'unchanged' in the summary and the row status", async () => {
    installMockHarvestFetch({
      [`/runs/${RUN_ID}`]: { run: RUN, attempts: ATTEMPTS },
    });
    renderRun();
    await screen.findByText("obs_512");
    expect(screen.getByText("unchanged")).toBeInTheDocument();
  });

  it("shows an error's detail behind a closed <details> disclosure", async () => {
    installMockHarvestFetch({
      [`/runs/${RUN_ID}`]: { run: RUN, attempts: ATTEMPTS },
    });
    const { user } = renderRun();
    await screen.findByText("obs_999");
    const summary = screen.getByText("detail");
    const details = summary.closest("details");
    expect(details.open).toBe(false);
    expect(screen.getByText("connection refused")).toBeInTheDocument();
    await user.click(summary);
    expect(details.open).toBe(true);
  });

  it("shows the fetch-error state for a run the API 404s", async () => {
    installMockHarvestFetch({ [`/runs/${RUN_ID}`]: null });
    renderRun();
    expect(await screen.findByText(/404/)).toBeInTheDocument();
  });

  it("shows the run's own error message when the run itself failed", async () => {
    installMockHarvestFetch({
      [`/runs/${RUN_ID}`]: {
        run: { ...RUN, status: "error", error_message: "flow crashed" },
        attempts: [],
      },
    });
    renderRun();
    expect(await screen.findByText("flow crashed")).toBeInTheDocument();
    expect(screen.getByText("No attempts recorded.")).toBeInTheDocument();
  });
});
