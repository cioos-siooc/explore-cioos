import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import { installMockHarvestFetch } from "../../test/mockHarvestFetch.js";
import HarvestCoverage from "./HarvestCoverage.jsx";

const COVERAGE = {
  summary: {
    n_app_total: 120,
    n_app_erddap: 100,
    n_app_obis: 20,
    n_ckan_records: 300,
    n_ckan_erddap_links: 90,
    n_ckan_obis_links: 15,
    ckan_snapshot_at: "2026-09-14T00:00:00Z",
    n_erddap_advertised: 107,
    n_erddap_not_in_app: 7,
    n_ckan_not_in_app: 4,
    n_app_without_ckan: 2,
    n_ckan_no_data_source: 30,
    n_obis_without_ckan: 5,
    n_obis_not_in_app: 6,
  },
  sources: [
    {
      erddap_url: "https://erddap.example.com/erddap",
      source: "erddap",
      n_advertised: 107,
      n_not_in_app: 7,
      n_without_ckan: 2,
      last_attempted_at: "2026-09-14T00:00:00Z",
    },
  ],
  ckanUrl: "https://catalogue.example.ca",
  bucketLimit: 500,
};

const ERDDAP_GAP = {
  rows: [
    {
      erddap_url: "https://erddap.example.com/erddap",
      dataset_id: "orphan_ds",
      status: "error",
      reason_code: "HTTP_ERROR",
      attempted_at: "2026-09-14T00:00:00Z",
    },
  ],
  truncated: false,
  limit: 500,
};

const CKAN_GAP = {
  rows: [
    {
      ckan_id: "ckan-1",
      ckan_name: "some-record",
      title: "A catalogued dataset",
      erddap_url: "https://other.example.ca/erddap",
      dataset_id: "unharvested_ds",
      classification: "server_not_harvested",
      reason_code: null,
    },
  ],
  truncated: false,
  limit: 500,
};

function stubRoutes(overrides = {}) {
  installMockHarvestFetch({
    "/coverage": COVERAGE,
    "/coverage/erddap-not-in-app": ERDDAP_GAP,
    "/coverage/ckan-not-in-app": CKAN_GAP,
    ...overrides,
  });
}

describe("HarvestCoverage", () => {
  beforeEach(() => {
    stubRoutes();
  });

  it("shows how many datasets are served, split by source", async () => {
    renderWithProviders(<HarvestCoverage />);
    expect(await screen.findByText("120")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
  });

  it("lists each data source alongside the metadata catalogue", async () => {
    renderWithProviders(<HarvestCoverage />);
    // The host also appears in the gap rows below, so match all occurrences.
    expect(
      (await screen.findAllByText("erddap.example.com")).length,
    ).toBeGreaterThan(0);
    // CKAN appears as a source too — it is what the data sources are diffed
    // against, so leaving it out would make the table read as data-only.
    expect(screen.getByText("catalogue.example.ca")).toBeInTheDocument();
  });

  it("defaults to the ERDDAP gap bucket and lists its rows", async () => {
    renderWithProviders(<HarvestCoverage />);
    expect(await screen.findByText("orphan_ds")).toBeInTheDocument();
    expect(screen.getByText("HTTP error")).toBeInTheDocument();
  });

  it("switches bucket and refetches that category", async () => {
    renderWithProviders(<HarvestCoverage />);
    await screen.findByText("orphan_ds");

    await userEvent.click(
      screen.getByRole("button", { name: /^In CKAN, not in CDE\d+$/i }),
    );

    await waitFor(() => {
      expect(screen.getByText("unharvested_ds")).toBeInTheDocument();
    });
    // The classification is the actionable part: this server is not in
    // harvest_config at all, which is a different fix from a failed harvest.
    expect(
      screen.getByText("Server not harvested by CDE"),
    ).toBeInTheDocument();
  });

  it("says when a bucket is empty rather than rendering a bare table", async () => {
    stubRoutes({ "/coverage/erddap-not-in-app": { rows: [], truncated: false, limit: 500 } });
    renderWithProviders(<HarvestCoverage />);
    expect(
      await screen.findByText("Nothing in this category."),
    ).toBeInTheDocument();
  });

  it("admits when the list was cut off", async () => {
    stubRoutes({
      "/coverage/erddap-not-in-app": { ...ERDDAP_GAP, truncated: true },
    });
    renderWithProviders(<HarvestCoverage />);
    expect(
      await screen.findByText(/Showing the first 500 rows/),
    ).toBeInTheDocument();
  });

  it("says so when no CKAN snapshot has been taken yet", async () => {
    // Fresh deploy: the table exists but no harvest has filled it, so every
    // CKAN comparison is empty. Without this the page reads as "the catalogue
    // describes none of our datasets".
    stubRoutes({
      "/coverage": { ...COVERAGE, summary: { ...COVERAGE.summary, n_ckan_records: 0 } },
    });
    renderWithProviders(<HarvestCoverage />);
    expect(await screen.findByText(/No CKAN snapshot yet/)).toBeInTheDocument();
  });

  it("omits that notice once a snapshot exists", async () => {
    renderWithProviders(<HarvestCoverage />);
    await screen.findByText("orphan_ds");
    expect(screen.queryByText(/No CKAN snapshot yet/)).not.toBeInTheDocument();
  });

  it("labels the OBIS-without-CKAN bucket as expected, not as a defect", async () => {
    stubRoutes({
      "/coverage/obis-without-ckan": { rows: [], truncated: false, limit: 500 },
    });
    renderWithProviders(<HarvestCoverage />);
    await screen.findByText("orphan_ds");

    await userEvent.click(
      screen.getByRole("button", { name: /^OBIS, no CKAN record\d+$/i }),
    );

    expect(
      await screen.findByText(/Expected, not a defect/),
    ).toBeInTheDocument();
  });
});
