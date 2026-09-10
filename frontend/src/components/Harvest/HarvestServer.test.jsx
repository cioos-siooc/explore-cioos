import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { Routes, Route } from "react-router-dom";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import { installMockHarvestFetch } from "../../test/mockHarvestFetch.js";
import HarvestServer from "./HarvestServer.jsx";

const SLUG = "erddap-example-com-erddap";
const DATASETS = [
  {
    erddap_url: "https://erddap.example.com/erddap",
    dataset_id: "obs_270",
    source: "erddap",
    status: "success",
    reason_code: null,
    error_message: null,
    duration_ms: 1200,
    attempted_at: "2024-03-01T00:00:00Z",
    run_id: "r1",
    warnings: null,
    history_statuses: ["success", "success"],
    content_hash: "abc123",
    content_hash_reason: null,
    last_updated_at: "2024-02-01T00:00:00Z",
  },
  {
    erddap_url: "https://erddap.example.com/erddap",
    dataset_id: "obs_512",
    source: "erddap",
    status: "error",
    reason_code: "HTTP_ERROR",
    error_message: "500",
    duration_ms: 300,
    attempted_at: "2024-03-01T00:05:00Z",
    run_id: "r1",
    warnings: null,
    history_statuses: ["error"],
    content_hash: null,
    content_hash_reason: "HASH_NO_FILE_LIST",
    last_updated_at: null,
  },
];
const REASONS = [{ reason_code: "HTTP_ERROR", n: 1 }];

function renderServer(url = `/harvest/server/${SLUG}`) {
  return renderWithProviders(
    <Routes>
      <Route path="/harvest/server/:slug" element={<HarvestServer />} />
    </Routes>,
    { url },
  );
}

describe("HarvestServer", () => {
  beforeEach(() => {
    installMockHarvestFetch({
      [`/servers/${SLUG}`]: DATASETS,
      [`/reasons/${SLUG}`]: REASONS,
    });
  });

  it("renders the resolved hostname, and a row per dataset", async () => {
    renderServer();
    expect(await screen.findByText("erddap.example.com")).toBeInTheDocument();
    expect(screen.getByText("obs_270")).toBeInTheDocument();
    expect(screen.getByText("obs_512")).toBeInTheDocument();
  });

  it("shows the file/source mode badge for hashable vs database-backed datasets", async () => {
    renderServer();
    await screen.findByText("obs_270");
    expect(screen.getByText("file")).toBeInTheDocument();
    expect(screen.getByText("source")).toBeInTheDocument();
  });

  it("shows the summary counts and the hashable count", async () => {
    renderServer();
    await screen.findByText("obs_270");
    expect(screen.getByText(/✓ 1/)).toBeInTheDocument();
    expect(screen.getByText(/✗ 1/)).toBeInTheDocument();
    expect(screen.getByText(/1 hashable/)).toBeInTheDocument();
  });

  it("shows the top failure reasons behind a details disclosure", async () => {
    renderServer();
    await screen.findByText("obs_270");
    expect(screen.getByText(/Top failure reasons/)).toBeInTheDocument();
    // "HTTP error" also appears as obs_512's own reason in the main table —
    // the disclosure's own copy is the one inside its <details>.
    const details = document.querySelector("details");
    expect(details).toHaveTextContent("HTTP error");
  });

  it("filtering by status re-fetches with the status query param", async () => {
    const { user } = renderServer();
    await screen.findByText("obs_270");
    installMockHarvestFetch({
      [`/servers/${SLUG}?status=error`]: [DATASETS[1]],
      [`/reasons/${SLUG}`]: REASONS,
    });
    await user.selectOptions(screen.getByDisplayValue("All statuses"), "error");
    await waitFor(() => {
      expect(screen.queryByText("obs_270")).not.toBeInTheDocument();
    });
    expect(screen.getByText("obs_512")).toBeInTheDocument();
  });

  it("searching applies the q param on Enter", async () => {
    const { user } = renderServer();
    await screen.findByText("obs_270");
    installMockHarvestFetch({
      [`/servers/${SLUG}?q=obs_512`]: [DATASETS[1]],
      [`/reasons/${SLUG}`]: REASONS,
    });
    await user.type(
      screen.getByPlaceholderText("Search dataset / reason / error…"),
      "obs_512{Enter}",
    );
    await waitFor(() => {
      expect(screen.queryByText("obs_270")).not.toBeInTheDocument();
    });
  });

  it("shows the no-datasets message when the server has none", async () => {
    installMockHarvestFetch({
      [`/servers/${SLUG}`]: [],
      [`/reasons/${SLUG}`]: [],
    });
    renderServer();
    expect(await screen.findByText("No datasets found.")).toBeInTheDocument();
  });
});
