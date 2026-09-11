import * as React from "react";
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { Routes, Route } from "react-router-dom";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import { installMockHarvestFetch } from "../../test/mockHarvestFetch.js";
import HarvestDownloadJob from "./HarvestDownloadJob.jsx";

const JOB_ID = "job-1";
const JOB = {
  job_id: JOB_ID,
  status: "completed",
  time: "2024-03-01T00:00:00Z",
  time_start: "2024-03-01T00:00:05Z",
  time_complete: "2024-03-01T00:00:35Z",
  duration_s: 30,
  download_size: 2048,
  estimate_size: 4096,
  error_message: null,
};
const DATASETS = [
  {
    dataset_id: "obs_270",
    erddap_url: "https://erddap.example.com/erddap",
    status: "COMPLETED",
    ckan_id: null,
    erddap_error: null,
    file_size: 2048,
  },
  {
    dataset_id: "obs_512",
    erddap_url: "https://erddap.example.com/erddap",
    status: "FAILED",
    ckan_id: null,
    erddap_error: "connection reset",
    file_size: null,
  },
];

function renderJob() {
  return renderWithProviders(
    <Routes>
      <Route
        path="/harvest/downloads/:jobId"
        element={<HarvestDownloadJob />}
      />
    </Routes>,
    { url: `/harvest/downloads/${JOB_ID}` },
  );
}

describe("HarvestDownloadJob", () => {
  it("shows the job's status, timing and size, and a row per dataset", async () => {
    installMockHarvestFetch({
      [`/downloads/${JOB_ID}`]: { job: JOB, datasets: DATASETS },
    });
    renderJob();
    expect(
      await screen.findByText("Download request job-1"),
    ).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(screen.getByText("obs_270")).toBeInTheDocument();
    expect(screen.getByText("obs_512")).toBeInTheDocument();
    expect(screen.getByText(/estimated/)).toBeInTheDocument();
  });

  it("shows a failed dataset's reason", async () => {
    installMockHarvestFetch({
      [`/downloads/${JOB_ID}`]: { job: JOB, datasets: DATASETS },
    });
    renderJob();
    await screen.findByText("obs_512");
    expect(screen.getByText("connection reset")).toBeInTheDocument();
  });

  it("shows the job's own error block when the job failed outright", async () => {
    installMockHarvestFetch({
      [`/downloads/${JOB_ID}`]: {
        job: { ...JOB, status: "failed", error_message: "traceback here" },
        datasets: [],
      },
    });
    renderJob();
    expect(await screen.findByText("traceback here")).toBeInTheDocument();
    expect(
      screen.getByText("No per-dataset detail was recorded for this request."),
    ).toBeInTheDocument();
  });

  it("shows the not-found state when the job doesn't resolve", async () => {
    installMockHarvestFetch({ [`/downloads/${JOB_ID}`]: null });
    renderJob();
    expect(
      await screen.findByText("Download request not found."),
    ).toBeInTheDocument();
  });
});
