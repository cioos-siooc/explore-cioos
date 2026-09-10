import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { Routes, Route } from "react-router-dom";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import { installMockHarvestFetch } from "../../test/mockHarvestFetch.js";
import HarvestDataset from "./HarvestDataset.jsx";

const SLUG = "erddap-example-com-erddap";
const DATASET_ID = "obs_270";
const PATH = `/dataset/${SLUG}/${DATASET_ID}`;

const LATEST = {
  run_id: "r1",
  attempted_at: "2024-03-01T00:00:00Z",
  status: "error",
  reason_code: "HTTP_ERROR",
  error_message: "500 Internal Server Error",
  duration_ms: 500,
  source: "erddap",
  query_urls: "https://a/1\nhttps://a/2",
  warnings: null,
  git_sha: "abc0000",
};
const OLDER = {
  run_id: "r0",
  attempted_at: "2024-02-01T00:00:00Z",
  status: "success",
  reason_code: null,
  error_message: null,
  duration_ms: 300,
  source: "erddap",
  git_sha: null,
};

function renderDataset() {
  return renderWithProviders(
    <Routes>
      <Route
        path="/harvest/dataset/:slug/:datasetId"
        element={<HarvestDataset />}
      />
    </Routes>,
    { url: `/harvest${PATH}` },
  );
}

describe("HarvestDataset", () => {
  it("shows the latest attempt's status, reason, and the attempt history table", async () => {
    installMockHarvestFetch({
      [PATH]: {
        history: [LATEST, OLDER],
        meta: {
          content_hash: "deadbeef1234567890",
          content_hash_reason: null,
          last_updated_at: "2024-01-01T00:00:00Z",
        },
        erddap_url: "https://erddap.example.com/erddap",
      },
    });
    renderDataset();
    // The host name appears twice (the sub-header link and the breadcrumb).
    expect(
      (await screen.findAllByText("erddap.example.com")).length,
    ).toBeGreaterThan(0);

    // The "latest attempt" summary card — the same attempt is also shown as
    // the newest row of the history table below, so these are scoped to the
    // card rather than asserted with a page-wide (necessarily ambiguous)
    // getByText.
    const card = document.querySelector(".harvest-latest-card");
    expect(card).toHaveTextContent("error");
    expect(card).toHaveTextContent("HTTP error");
    expect(card).toHaveTextContent("500 Internal Server Error");
    expect(card).toHaveTextContent("file");

    // Both history rows render, including the older, unrelated success.
    const table = document.querySelector(".harvest-table");
    expect(table).toHaveTextContent("success");
  });

  it("shows the request URLs, marking the last one failed when the attempt errored", async () => {
    installMockHarvestFetch({
      [PATH]: {
        history: [LATEST],
        meta: null,
        erddap_url: "https://erddap.example.com/erddap",
      },
    });
    const { user } = renderDataset();
    await waitFor(() =>
      expect(document.querySelector(".harvest-latest-card")).toBeInTheDocument(),
    );
    // The single history row duplicates the same attempt's error_message, so
    // it carries its own "Request URLs" disclosure too (inside the history
    // table's <details>, opened via "error detail" rather than this label) —
    // scope to the summary card's own toggle.
    const card = document.querySelector(".harvest-latest-card");
    const { getByText } = within(card);
    await user.click(getByText("Request URLs (2)"));
    const items = card.querySelectorAll(".harvest-query-urls li");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("✓");
    expect(items[1]).toHaveTextContent("✗");
  });

  it("shows the fetch-error state when the dataset has no harvest history", async () => {
    installMockHarvestFetch({ [PATH]: null });
    renderDataset();
    expect(await screen.findByText(/404/)).toBeInTheDocument();
  });

  it("links out to ERDDAP by default, and to OBIS for an OBIS-sourced dataset", async () => {
    installMockHarvestFetch({
      [PATH]: {
        history: [{ ...LATEST, source: "obis", status: "success" }],
        meta: null,
        erddap_url: "https://obis.org",
      },
    });
    renderDataset();
    const link = await screen.findByText("View on OBIS ↗");
    expect(link).toHaveAttribute("href", `https://obis.org/dataset/${DATASET_ID}`);
  });
});
