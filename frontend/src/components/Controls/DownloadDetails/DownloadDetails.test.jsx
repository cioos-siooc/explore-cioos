import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import DownloadDetails from "./DownloadDetails.jsx";
import downloadEstimateFixture from "../../../../e2e/fixtures/api/downloadEstimate.json";

// downloadEstimate.json: [{ pk: 1811, size: 184320 }, { pk: 2337, size: 923648 }]
const [EST_SMALL, EST_LARGE] = downloadEstimateFixture;

function makePoint(overrides) {
  return {
    pk: 1,
    title: "Some station",
    cdm_data_type: "TimeSeries",
    ...overrides,
  };
}

const QUERY = {
  startDate: "1900-01-01",
  endDate: "2024-01-01",
  startDepth: 0,
  endDepth: 12000,
  eovsSelected: [],
  orgsSelected: [],
  datasetsSelected: [],
  platformsSelected: [],
  scientificNamesSelected: [],
  obisNodesSelected: [],
  erddapServersSelected: [],
};

// Module-level so a rerender passes the same callbacks, as the app does:
// setSubmissionState is a dependency of the estimate effect, and a fresh
// function would refetch the estimates.
const noop = () => {};

function detailsElement(props) {
  return (
    <DownloadDetails
      pointsToReview={[
        makePoint({ pk: EST_SMALL.pk, title: "Small dataset" }),
        makePoint({ pk: EST_LARGE.pk, title: "Large dataset" }),
      ]}
      setPointsToDownload={noop}
      setHoveredDataset={noop}
      polygon={undefined}
      query={QUERY}
      timeFilterActive={false}
      filterDownloadByTime={false}
      setFilterDownloadByTime={noop}
      depthFilterActive={false}
      filterDownloadByDepth={false}
      setFilterDownloadByDepth={noop}
      polygonFilterActive={false}
      filterDownloadByPolygon={false}
      setFilterDownloadByPolygon={noop}
      setSubmissionState={noop}
      {...props}
    />
  );
}

function renderDetails(props) {
  return renderWithProviders(detailsElement(props), { providers: "app" });
}

describe("DownloadDetails", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("filters griddap (metadata-only) datasets out of the reviewable set", async () => {
    renderDetails({
      pointsToReview: [
        makePoint({ pk: EST_SMALL.pk, title: "Small dataset" }),
        makePoint({ pk: 999, title: "A grid", cdm_data_type: "Grid" }),
      ],
    });
    await waitFor(() =>
      expect(screen.getByText("Small dataset")).toBeInTheDocument(),
    );
    expect(screen.queryByText("A grid")).not.toBeInTheDocument();
  });

  it("shows the no-filters-active message when nothing is filtering the download", async () => {
    renderDetails();
    expect(
      screen.getByText("No Time, Depth, or Space filters currently active"),
    ).toBeInTheDocument();
  });

  it("shows a time filter chip when the time filter is active, and toggling it calls back", async () => {
    const setFilterDownloadByTime = vi.fn();
    const { user } = renderDetails({
      timeFilterActive: true,
      filterDownloadByTime: true,
      setFilterDownloadByTime,
    });
    const chip = await screen.findByText(
      `${QUERY.startDate} – ${QUERY.endDate}`,
    );
    await user.click(chip);
    expect(setFilterDownloadByTime).toHaveBeenCalledWith(false);
  });

  it("resolves size estimates from /downloadEstimate and shows the total once loaded", async () => {
    renderDetails();
    await waitFor(() => {
      expect(screen.getAllByText("Small dataset")[0]).toBeInTheDocument();
    });
    // Both datasets are well under the 1GB CDE limit.
    await waitFor(() => {
      expect(document.querySelector(".downloadSummaryValue")).toHaveTextContent(
        "2 / 2",
      );
    });
  });

  it("marks a dataset over the 1GB CDE limit as not internally downloadable", async () => {
    renderDetails({
      pointsToReview: [
        makePoint({ pk: 999999, title: "Huge dataset" }),
        makePoint({ pk: EST_SMALL.pk, title: "Small dataset" }),
      ],
    });
    // A real dataset under the limit stays selectable, confirming the merge
    // picked up its fixture size.
    await waitFor(() => {
      expect(screen.getByText("Small dataset")).toBeInTheDocument();
    });
  });

  it("clicking Select all toggles every non-disabled dataset's selection", async () => {
    const { user } = renderDetails();
    await waitFor(() =>
      expect(screen.getByText("Small dataset")).toBeInTheDocument(),
    );
    const selectAll = screen.getByTitle("Select all");
    await user.click(selectAll);
    expect(selectAll).toBeInTheDocument();
  });

  it("follows the selection when a dataset is removed from it while open", async () => {
    const small = makePoint({ pk: EST_SMALL.pk, title: "Small dataset" });
    const large = makePoint({ pk: EST_LARGE.pk, title: "Large dataset" });
    const setPointsToDownload = vi.fn();
    const { rerender } = renderDetails({
      pointsToReview: [small, large],
      setPointsToDownload,
    });
    await waitFor(() =>
      expect(document.querySelector(".downloadSummaryValue")).toHaveTextContent(
        "2 / 2",
      ),
    );
    const estimateRequests = () =>
      global.fetch.mock.calls.filter(([url]) =>
        String(url).includes("/downloadEstimate"),
      ).length;
    const requestsBefore = estimateRequests();

    rerender(detailsElement({ pointsToReview: [small], setPointsToDownload }));

    await waitFor(() =>
      expect(screen.getAllByTestId("dataset-card")).toHaveLength(1),
    );
    expect(document.querySelector(".downloadSummaryValue")).toHaveTextContent(
      "1 / 1",
    );
    expect(
      screen.queryByRole("button", {
        name: "Remove from the download selection: Large dataset",
      }),
    ).not.toBeInTheDocument();
    expect(setPointsToDownload).toHaveBeenLastCalledWith([
      expect.objectContaining({ pk: EST_SMALL.pk }),
    ]);
    expect(estimateRequests()).toBe(requestsBefore);
  });

  it("reports the error and stops the spinner when /downloadEstimate fails", async () => {
    installMockFetch();
    const realFetch = global.fetch;
    global.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/downloadEstimate")) {
        return Promise.resolve(new Response(null, { status: 500 }));
      }
      return realFetch(input, init);
    };
    renderDetails();
    await waitFor(() => {
      expect(
        document.querySelector(".datasetSizeTotalSpinner"),
      ).not.toBeInTheDocument();
    });
    // Every card without an estimate carries the same title, so scope to the
    // order summary's own figure rather than asserting a single match.
    expect(
      document.querySelector(".downloadSummaryValue[title]"),
    ).toHaveAttribute("title", "Size estimate unavailable");
  });

  it("asks /downloadEstimate for the basket once, with no empty parameter, even under a Datasets filter", async () => {
    const urls = [];
    const realFetch = global.fetch;
    global.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/downloadEstimate")) urls.push(url);
      return realFetch(input, init);
    };
    renderDetails({
      timeFilterActive: true,
      filterDownloadByTime: true,
      query: {
        ...QUERY,
        datasetsSelected: [
          { pk: EST_SMALL.pk, isSelected: true },
          { pk: EST_LARGE.pk, isSelected: false },
        ],
      },
    });
    await waitFor(() => expect(urls.length).toBeGreaterThanOrEqual(2));
    for (const url of urls) {
      expect(url).not.toMatch(/\?&|&&|&$/);
      expect(new URL(url).searchParams.getAll("datasetPKs")).toEqual([
        `${EST_SMALL.pk},${EST_LARGE.pk}`,
      ]);
    }
    expect(urls.some((url) => new URL(url).searchParams.has("timeMax"))).toBe(
      true,
    );
  });

  it("keeps the links under a polygon filter, flagged as not applying it", async () => {
    const polygon = [
      [-65, 44],
      [-62, 44],
      [-63, 45],
      [-65, 44],
    ];
    const pointsToReview = [
      makePoint({
        pk: EST_SMALL.pk,
        dataset_id: "small",
        source_type: "erddap",
        erddap_server_url: "https://data.example.ca/erddap",
      }),
    ];
    const { rerender } = renderDetails({ pointsToReview });
    const csv = () => screen.getByRole("button", { name: /dataset list/i });
    expect(csv()).toBeEnabled();
    expect(screen.queryByText("Unfiltered")).not.toBeInTheDocument();

    rerender(
      detailsElement({
        pointsToReview,
        polygon,
        filterDownloadByPolygon: true,
      }),
    );
    expect(csv()).toBeEnabled();
    expect(screen.getByText("Unfiltered").closest("span")).toHaveAttribute(
      "title",
      "This link doesn't apply your polygon filter.",
    );
    expect(screen.getByTestId("download-links")).toHaveTextContent(
      /polygon isn't applied/i,
    );
  });

  it("links each card to its source download", async () => {
    renderDetails({
      pointsToReview: [
        makePoint({
          pk: EST_SMALL.pk,
          dataset_id: "small",
          source_type: "erddap",
          erddap_server_url: "https://data.example.ca/erddap",
        }),
        makePoint({
          pk: EST_LARGE.pk,
          dataset_id: "fish",
          source_type: "obis",
          cdm_data_type: "Point",
          erddap_server_url: "https://obis.org",
          erddap_url: "https://obis.org/dataset/fish",
          archive_url: "https://ipt.example.org/archive.do?r=fish",
        }),
      ],
    });
    expect(screen.getByRole("link", { name: "Data" })).toHaveAttribute(
      "href",
      "https://data.example.ca/erddap/tabledap/small.csv?",
    );
    expect(screen.getByRole("link", { name: "DwC-A" })).toHaveAttribute(
      "href",
      "https://ipt.example.org/archive.do?r=fish",
    );
    expect(screen.getByRole("link", { name: "OBIS" })).toHaveAttribute(
      "href",
      "https://obis.org/dataset/fish",
    );
  });

  it("asks for the citations of every dataset in the selection", async () => {
    const source = { erddap_server_url: "https://data.example.ca/erddap" };
    const { user } = renderDetails({
      pointsToReview: [
        makePoint({ pk: EST_SMALL.pk, dataset_id: "small", ...source }),
        makePoint({ pk: EST_LARGE.pk, dataset_id: "large", ...source }),
      ],
    });
    await user.click(screen.getByRole("button", { name: /dataset list/i }));
    const asked = fetch.mock.calls
      .map(([url]) => new URL(url, "http://localhost"))
      .find((url) => url.pathname.endsWith("/datasets/citations"));
    expect(asked.searchParams.get("datasetPKs")).toBe(
      `${EST_SMALL.pk},${EST_LARGE.pk}`,
    );
  });

  it("names the OBIS datasets a format without an OBIS version turns into CSV", async () => {
    const { user } = renderDetails({
      pointsToReview: [
        makePoint({ pk: EST_SMALL.pk, title: "Small dataset" }),
        makePoint({
          pk: EST_LARGE.pk,
          title: "Fish survey",
          source_type: "obis",
          erddap_url: "https://obis.org",
        }),
      ],
    });
    const format = screen.getByLabelText("All downloads");
    expect(
      within(screen.getByRole("group", { name: "ERDDAP and OBIS" }))
        .getAllByRole("option")
        .map((option) => option.value),
    ).toEqual(["csv", "parquet"]);
    expect(
      within(screen.getByRole("group", { name: "ERDDAP only (OBIS as CSV)" }))
        .getAllByRole("option")
        .map((option) => option.value),
    ).toEqual(["odv", "nccf"]);
    expect(screen.queryByText(/delivered as CSV/)).not.toBeInTheDocument();
    expect(screen.queryByText("As CSV")).not.toBeInTheDocument();

    await user.selectOptions(format, "odv");
    expect(
      screen.getByText(
        "1 OBIS dataset will be delivered as CSV: OBIS has no ODV spreadsheet version. Choose CSV or Parquet to get every dataset in one format.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("As CSV")).toHaveLength(1);

    await user.selectOptions(format, "parquet");
    expect(screen.queryByText(/delivered as CSV/)).not.toBeInTheDocument();
  });
});
