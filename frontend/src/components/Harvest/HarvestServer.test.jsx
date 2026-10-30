import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { Routes, Route } from "react-router";

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
const WARNINGS = [
  {
    code: "NON_CF_STANDARD_NAMES",
    n_datasets: 1,
    total_count: 4,
    dataset_ids: ["obs_270"],
  },
];
const WARNED = {
  ...DATASETS[0],
  warnings: [
    { code: "NON_CF_STANDARD_NAMES", message: "4 non-CF names", count: 4 },
    { code: "DAY_COUNT_FALLBACK", message: "used the time span" },
  ],
};

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
      [`/warnings/${SLUG}`]: WARNINGS,
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

  it("shows the hashable count", async () => {
    renderServer();
    await screen.findByText("obs_270");
    expect(screen.getByText(/1 hashable/)).toBeInTheDocument();
  });

  it("charts harvested datasets against failures split by reason", async () => {
    renderServer();
    await screen.findByText("obs_270");
    expect(
      screen.getByRole("img", {
        name: "1 of 2 datasets harvested in the last run",
      }),
    ).toBeInTheDocument();
    const legend = document.querySelector(".harvest-pie-legend");
    expect(legend).toHaveTextContent("Harvested1 · 50%");
    expect(legend).toHaveTextContent("HTTP error1 · 50%");
  });

  it("clicking a pie reason filters the table to it and keeps the whole-server pie", async () => {
    const { user } = renderServer();
    await screen.findByText("obs_270");
    installMockHarvestFetch({
      [`/servers/${SLUG}?status=error`]: [DATASETS[1]],
      [`/servers/${SLUG}`]: DATASETS,
      [`/warnings/${SLUG}`]: WARNINGS,
    });
    const reasonItem = screen.getByRole("button", { name: /HTTP error/ });
    await user.click(reasonItem);
    await waitFor(() => {
      expect(screen.queryByText("obs_270")).not.toBeInTheDocument();
    });
    expect(screen.getByText("obs_512")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /HTTP error/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("img", {
        name: "1 of 2 datasets harvested in the last run",
      }),
    ).toBeInTheDocument();
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

  it("lists the server's warnings by code with dataset and total counts", async () => {
    renderServer();
    const summary = await screen.findByText("Warnings (1)");
    const details = summary.closest("details");
    expect(details).toHaveTextContent("Non-CF standard names");
    const cells = details.querySelectorAll("tbody td");
    expect(cells[1]).toHaveTextContent("1");
    expect(cells[2]).toHaveTextContent("4");
  });

  it("clicking a warning filters the table via the warning URL param, and the chip clears it", async () => {
    const { user } = renderServer();
    await screen.findByText("obs_270");
    installMockHarvestFetch({
      [`/servers/${SLUG}`]: DATASETS,
      [`/servers/${SLUG}?warning=NON_CF_STANDARD_NAMES`]: [WARNED],
      [`/reasons/${SLUG}`]: REASONS,
      [`/warnings/${SLUG}`]: WARNINGS,
    });
    await user.click(screen.getByText("Warnings (1)"));
    await user.click(
      screen.getByRole("button", { name: /Non-CF standard names/ }),
    );
    await waitFor(() => {
      expect(screen.queryByText("obs_512")).not.toBeInTheDocument();
    });
    expect(
      screen.getByText(/Warning: Non-CF standard names/),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Remove warning filter" }),
    );
    expect(await screen.findByText("obs_512")).toBeInTheDocument();
    expect(screen.queryByText(/Warning: /)).not.toBeInTheDocument();
  });

  it("seeds the warning filter from the URL", async () => {
    installMockHarvestFetch({
      [`/servers/${SLUG}?warning=NON_CF_STANDARD_NAMES`]: [WARNED],
      [`/reasons/${SLUG}`]: REASONS,
      [`/warnings/${SLUG}`]: WARNINGS,
    });
    renderServer(`/harvest/server/${SLUG}?warning=NON_CF_STANDARD_NAMES`);
    expect(await screen.findByText("obs_270")).toBeInTheDocument();
    expect(
      screen.getByText(/Warning: Non-CF standard names/),
    ).toBeInTheDocument();
  });

  it("shows the first warning's label plus how many more in the reason column", async () => {
    installMockHarvestFetch({
      [`/servers/${SLUG}`]: [WARNED],
      [`/reasons/${SLUG}`]: [],
      [`/warnings/${SLUG}`]: [],
    });
    renderServer();
    const cell = await screen.findByText(/Non-CF standard names \+1 more/);
    expect(cell).toHaveAttribute("title", "4 non-CF names\nused the time span");
  });
});
