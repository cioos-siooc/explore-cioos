import * as React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import { installMockHarvestFetch } from "../../test/mockHarvestFetch.js";
import HarvestCoverage from "./HarvestCoverage.jsx";

// Plotly draws to a real canvas and probes media queries jsdom's stub does
// not answer (src/test/viewport.js), same as CoverageModal.test.jsx. This
// suite is about what buildIntegration() computes, not the chart itself, so
// a stand-in exposes the rings/total reaching the donut.
vi.mock("./CoverageDonut.jsx", () => ({
  default: ({ rings, total, centerLabel, caption }) => (
    <div data-testid="coverage-donut">
      <div data-testid="coverage-donut-total">{total}</div>
      <div data-testid="coverage-donut-label">{centerLabel}</div>
      <p>{caption}</p>
      <ul>
        {rings.flat().map((seg) => (
          <li key={seg.key} data-testid="coverage-donut-segment">
            <span data-testid="coverage-donut-segment-label">{seg.label}</span>
            <span data-testid="coverage-donut-segment-value">{seg.value}</span>
          </li>
        ))}
      </ul>
    </div>
  ),
}));

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
    n_ckan_not_integrated: 4,
    n_erddap_without_ckan: 2,
    n_ckan_no_data_source: 30,
    n_ckan_only_datasets: 12,
    n_obis_without_ckan: 5,
    n_obis_not_harvested: 290,
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
  total: 1,
  offset: 0,
  limit: 50,
};

const CKAN_GAP = {
  rows: [
    {
      ckan_id: "ckan-1",
      ckan_name: "some-record",
      title: "A catalogued dataset",
      erddap_url: "https://other.example.ca/erddap",
      dataset_id: "unharvested_ds",
      obis_dataset_id: null,
      n_resources: 1,
      classification: "server_not_harvested",
      reason_code: null,
    },
    {
      ckan_id: "ckan-2",
      ckan_name: "doc-only",
      title: "A record with nothing behind it",
      erddap_url: null,
      dataset_id: null,
      obis_dataset_id: null,
      n_resources: 2,
      classification: "no_data_source",
      reason_code: null,
    },
  ],
  total: 2,
  offset: 0,
  limit: 50,
};

function stubRoutes(overrides = {}) {
  installMockHarvestFetch({
    "/coverage": COVERAGE,
    "/coverage/erddap-not-in-app": ERDDAP_GAP,
    "/coverage/ckan-not-integrated": CKAN_GAP,
    ...overrides,
  });
}

describe("HarvestCoverage", () => {
  beforeEach(() => {
    stubRoutes();
  });

  it("shows how many datasets are served, split by source", async () => {
    const { container } = renderWithProviders(<HarvestCoverage />);
    await screen.findByRole("heading", { name: "Sources" });
    // Scoped to the stat row: the donut legend repeats these same counts, so a
    // bare getByText would match more than one node.
    const stats = container.querySelectorAll(".harvest-coverage-stat-value");
    expect([...stats].map((n) => n.textContent)).toEqual([
      "120",
      "100",
      "20",
      "300",
    ]);
  });

  it("charts the integrated fraction over both levels", async () => {
    const { container } = renderWithProviders(<HarvestCoverage />);
    await screen.findByRole("heading", { name: "Sources" });

    // Ring 1 is integrated vs not; ring 2 splits each by source. 100 + 20
    // served against 7 + 290 advertised-but-missing, plus 12 datasets only
    // CKAN knows of and 30 records backing no data at all = 459 known.
    expect(screen.getByTestId("coverage-donut-total").textContent).toBe("459");
    expect(
      container.querySelectorAll('[data-testid="coverage-donut-segment"]'),
    ).toHaveLength(8);

    // The CKAN slices must not swallow datasets the source gaps already count:
    // ring 2 has to sum to the whole, and ring 1's halves to the same total.
    const values = [
      ...container.querySelectorAll(
        '[data-testid="coverage-donut-segment-value"]',
      ),
    ].map((n) => Number(n.textContent));
    const [integrated, missing, ...outer] = values;
    expect(integrated + missing).toBe(459);
    expect(outer.reduce((a, b) => a + b, 0)).toBe(459);
    expect(screen.getByText("ERDDAP · not integrated")).toBeInTheDocument();
    expect(screen.getByText("OBIS · not integrated")).toBeInTheDocument();
  });

  it("names every segment, so identity never rests on colour alone", async () => {
    const { container } = renderWithProviders(<HarvestCoverage />);
    await screen.findByRole("heading", { name: "Sources" });

    // Every segment reaching the donut carries a real label and a numeric
    // value, rather than expecting colour alone to identify it.
    const segments = container.querySelectorAll(
      '[data-testid="coverage-donut-segment"]',
    );
    expect(segments).toHaveLength(8);
    segments.forEach((seg) => {
      expect(
        seg.querySelector('[data-testid="coverage-donut-segment-label"]')
          .textContent,
      ).not.toBe("");
      expect(
        Number(
          seg.querySelector('[data-testid="coverage-donut-segment-value"]')
            .textContent,
        ),
      ).not.toBeNaN();
    });
  });

  it("shows the catalogue's gap as the same measure its bucket counts", async () => {
    // Both sit under "not in CDE"; showing the ERDDAP-linked subset in one and
    // the all-records figure in the other read as a contradiction.
    const { container } = renderWithProviders(<HarvestCoverage />);
    await screen.findByRole("heading", { name: "Sources" });

    const ckanRow = [...container.querySelectorAll("tbody tr")].find((tr) =>
      tr.textContent.includes("catalogue.example.ca"),
    );
    const chip = screen.getByRole("button", {
      name: /^In CKAN, not in CDE\d+$/i,
    });
    expect(chip.textContent).toContain(
      ckanRow.querySelectorAll("td")[3].textContent,
    );
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

  it("lists records with no data source alongside unharvested ones", async () => {
    // One list for the whole metadata-side gap: a record pointing at a server
    // CDE does not harvest and a record pointing at nothing both belong here,
    // told apart by the reason column rather than by living in separate tabs.
    renderWithProviders(<HarvestCoverage />);
    await screen.findByText("orphan_ds");

    await userEvent.click(
      screen.getByRole("button", { name: /^In CKAN, not in CDE\d+$/i }),
    );

    expect(await screen.findByText("unharvested_ds")).toBeInTheDocument();
    expect(
      screen.getByText("A record with nothing behind it"),
    ).toBeInTheDocument();
    expect(screen.getByText(/No ERDDAP or OBIS link/)).toBeInTheDocument();
    expect(screen.getByText("No data source CDE can read")).toBeInTheDocument();
  });

  it("offers the full list as CSV, since the table is capped", async () => {
    renderWithProviders(<HarvestCoverage />);
    await screen.findByText("orphan_ds");

    await userEvent.click(
      screen.getByRole("button", { name: /^In CKAN, not in CDE\d+$/i }),
    );

    const link = await screen.findByRole("link", {
      name: /full list \(CSV\)/i,
    });
    expect(link.getAttribute("href")).toContain(
      "/harvest/coverage/ckan-not-integrated?format=csv",
    );
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
    expect(screen.getByText("Server not harvested by CDE")).toBeInTheDocument();
  });

  it("says when a bucket is empty rather than rendering a bare table", async () => {
    stubRoutes({
      "/coverage/erddap-not-in-app": {
        rows: [],
        total: 0,
        offset: 0,
        limit: 50,
      },
    });
    renderWithProviders(<HarvestCoverage />);
    expect(
      await screen.findByText("Nothing in this category."),
    ).toBeInTheDocument();
  });

  it("walks a long bucket a page at a time", async () => {
    const page1 = { ...ERDDAP_GAP, total: 120, offset: 0, limit: 50 };
    const page2 = {
      rows: [{ ...ERDDAP_GAP.rows[0], dataset_id: "second_page_ds" }],
      total: 120,
      offset: 50,
      limit: 50,
    };
    stubRoutes({
      "/coverage/erddap-not-in-app": page1,
      "/coverage/erddap-not-in-app?page=2": page2,
    });
    renderWithProviders(<HarvestCoverage />);
    await screen.findByText("orphan_ds");

    // The range is the count the page can state honestly: the table holds one
    // slice, not "the first 50 of however many there are".
    expect(screen.getByText("1–50 of 120")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Previous/ })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: /Next/ }));

    expect(await screen.findByText("second_page_ds")).toBeInTheDocument();
    expect(screen.getByText("51–100 of 120")).toBeInTheDocument();
  });

  it("returns to page one when the bucket changes", async () => {
    // Page 7 of a 3500-row bucket is past the end of a 12-row one, so the
    // page number cannot survive a switch — it would fetch an empty slice.
    stubRoutes({
      "/coverage/erddap-not-in-app": { ...ERDDAP_GAP, total: 120 },
      "/coverage/erddap-not-in-app?page=2": {
        rows: [{ ...ERDDAP_GAP.rows[0], dataset_id: "second_page_ds" }],
        total: 120,
        offset: 50,
        limit: 50,
      },
    });
    renderWithProviders(<HarvestCoverage />);
    await screen.findByText("orphan_ds");
    await userEvent.click(screen.getByRole("button", { name: /Next/ }));
    await screen.findByText("second_page_ds");

    await userEvent.click(
      screen.getByRole("button", { name: /^In CKAN, not in CDE\d+$/i }),
    );

    // The unsuffixed path is page one; a leftover ?page=2 would 404 the stub.
    expect(await screen.findByText("unharvested_ds")).toBeInTheDocument();
  });

  it("defines each group of the report, not just names it", async () => {
    renderWithProviders(<HarvestCoverage />);
    await screen.findByRole("heading", { name: "Sources" });

    expect(
      screen.getByText(/counted as datasets, beside the number of records/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Every place CDE reads from/)).toBeInTheDocument();
    expect(
      screen.getByText(/appear on one side of that comparison/),
    ).toBeInTheDocument();
  });

  it("says so when no CKAN snapshot has been taken yet", async () => {
    // Fresh deploy: the table exists but no harvest has filled it, so every
    // CKAN comparison is empty. Without this the page reads as "the catalogue
    // describes none of our datasets".
    stubRoutes({
      "/coverage": {
        ...COVERAGE,
        summary: { ...COVERAGE.summary, n_ckan_records: 0 },
      },
    });
    renderWithProviders(<HarvestCoverage />);
    expect(await screen.findByText(/No CKAN snapshot yet/)).toBeInTheDocument();
  });

  it("omits that notice once a snapshot exists", async () => {
    renderWithProviders(<HarvestCoverage />);
    await screen.findByText("orphan_ds");
    expect(screen.queryByText(/No CKAN snapshot yet/)).not.toBeInTheDocument();
  });

  it("frames the ERDDAP-without-CKAN bucket as a review list, not a fault", async () => {
    // CKAN does not describe every ERDDAP dataset either, and those datasets
    // stay in Explorer — so this bucket must not read as a set of breakages.
    stubRoutes({
      "/coverage/erddap-without-ckan": {
        rows: [],
        total: 0,
        offset: 0,
        limit: 50,
      },
    });
    renderWithProviders(<HarvestCoverage />);
    await screen.findByText("orphan_ds");

    await userEvent.click(
      screen.getByRole("button", { name: /^ERDDAP, no CKAN record\d+$/i }),
    );

    expect(await screen.findByText(/not a fault/)).toBeInTheDocument();
    expect(
      screen.getByText(/stay available\s+in Explorer/),
    ).toBeInTheDocument();
  });

  it("labels the OBIS-without-CKAN bucket as expected, not as a defect", async () => {
    stubRoutes({
      "/coverage/obis-without-ckan": {
        rows: [],
        total: 0,
        offset: 0,
        limit: 50,
      },
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
