import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import TimeDistribution from "./TimeDistribution.jsx";

vi.mock("../CoverageHistogramPlot/CoverageHistogramPlot.jsx", () => ({
  default: ({ histogram }) => (
    <div data-testid="plot">{histogram.cells.length}</div>
  ),
}));

const HISTOGRAM = {
  count: "days",
  view: "timeline",
  timeBinEdges: ["2020-01-01T00:00:00Z", "2021-01-01T00:00:00Z"],
  series: [{ key: "erddap", kind: "erddap", total: 3 }],
  cells: [[1, "erddap", 3]],
};

let responses;

beforeEach(() => {
  responses = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        responses.shift() ?? new Response(JSON.stringify(HISTOGRAM)),
      ),
    ),
  );
});

function requested() {
  return new URL(fetch.mock.lastCall[0]).searchParams;
}

describe("TimeDistribution", () => {
  it("asks for this dataset's days within the active filters", async () => {
    renderWithProviders(
      <TimeDistribution
        datasetPk={42}
        query="timeMin=2020-01-01&depthMax=50&datasetPKs=1,2"
      />,
    );
    expect(await screen.findByTestId("plot")).toHaveTextContent("1");
    const params = requested();
    expect(params.get("datasetPKs")).toBe("42");
    expect(params.get("timeMin")).toBe("2020-01-01");
    expect(params.get("depthMax")).toBe("50");
    expect(params.get("count")).toBe("days");
    expect(params.get("view")).toBe("timeline");
  });

  it("refetches when the filters change", async () => {
    const { rerender } = renderWithProviders(
      <TimeDistribution datasetPk={42} query="depthMax=50" />,
    );
    await screen.findByTestId("plot");
    rerender(<TimeDistribution datasetPk={42} query="depthMax=10" />);
    await waitFor(() => expect(requested().get("depthMax")).toBe("10"));
  });

  it("folds the years onto one when switched to seasonal", async () => {
    renderWithProviders(<TimeDistribution datasetPk={42} query="" />);
    await screen.findByTestId("plot");
    await userEvent.click(
      screen.getByRole("button", { name: "By time of year" }),
    );
    await waitFor(() => expect(requested().get("view")).toBe("seasonal"));
  });

  it("says so when the filters leave none of the dataset", async () => {
    responses.push(new Response(JSON.stringify({ ...HISTOGRAM, cells: [] })));
    renderWithProviders(<TimeDistribution datasetPk={42} query="" />);
    expect(
      await screen.findByText(
        "No data from this dataset matches the active filters.",
      ),
    ).toBeInTheDocument();
  });

  it("offers a retry after a failed load", async () => {
    responses.push(new Response("boom", { status: 500 }));
    renderWithProviders(<TimeDistribution datasetPk={42} query="" />);
    await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("plot")).toBeInTheDocument();
  });
});
