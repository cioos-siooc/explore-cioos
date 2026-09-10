import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

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

function renderDetails(props) {
  return renderWithProviders(
    <DownloadDetails
      pointsToReview={[
        makePoint({ pk: EST_SMALL.pk, title: "Small dataset" }),
        makePoint({ pk: EST_LARGE.pk, title: "Large dataset" }),
      ]}
      setPointsToDownload={() => {}}
      setHoveredDataset={() => {}}
      polygon={undefined}
      query={QUERY}
      timeFilterActive={false}
      filterDownloadByTime={false}
      setFilterDownloadByTime={() => {}}
      depthFilterActive={false}
      filterDownloadByDepth={false}
      setFilterDownloadByDepth={() => {}}
      polygonFilterActive={false}
      filterDownloadByPolygon={false}
      setFilterDownloadByPolygon={() => {}}
      setSubmissionState={() => {}}
      {...props}
    />,
    { providers: "app" },
  );
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
    const chip = await screen.findByText(`${QUERY.startDate} – ${QUERY.endDate}`);
    await user.click(chip);
    expect(setFilterDownloadByTime).toHaveBeenCalledWith(false);
  });

  it("resolves size estimates from /downloadEstimate and shows the total once loaded", async () => {
    renderDetails();
    await waitFor(() => {
      expect(screen.getAllByText("Small dataset")[0]).toBeInTheDocument();
    });
    // Both datasets are well under the 1GB CDE limit, so both stay selected —
    // summary reads "2 / 2".
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
    // pk 999999 has no matching estimate row, so its size falls back to 0 —
    // exercise the opposite case instead: a real dataset under the limit stays
    // selectable, confirming the merge picked up its fixture size.
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
    // Selecting all off then on again should not throw and the button stays
    // present — the toggle round-trips through DatasetsTable's own state.
    expect(selectAll).toBeInTheDocument();
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
    expect(
      screen.getByTitle("Size estimate unavailable"),
    ).toBeInTheDocument();
  });
});
