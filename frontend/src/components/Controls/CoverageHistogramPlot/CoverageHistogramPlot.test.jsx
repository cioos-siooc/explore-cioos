import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import CoverageHistogramPlot from "./CoverageHistogramPlot.jsx";

// Plotly draws to a real canvas jsdom does not have. The stand-in lists the
// trace names, which is all Plotly would put in the legend.
vi.mock("plotly.js-basic-dist-min", () => ({ default: { register() {} } }));
vi.mock("react-plotly.js/factory", () => ({
  default:
    () =>
    ({ data }) => (
      <ul>
        {data.map((trace) => (
          <li key={trace.name}>{trace.name}</li>
        ))}
      </ul>
    ),
}));

describe("CoverageHistogramPlot", () => {
  it("names data-type series the way the geometry filter does", () => {
    renderWithProviders(
      <CoverageHistogramPlot
        histogram={{
          count: "datasets",
          timeBinEdges: ["2020-01-01T00:00:00Z", "2021-01-01T00:00:00Z"],
          series: [
            { key: "TimeSeries", kind: "dataType", total: 3 },
            { key: "Grid", kind: "dataType", total: 1 },
          ],
          cells: [
            [1, "TimeSeries", 3],
            [1, "Grid", 1],
          ],
        }}
      />,
    );
    expect(
      screen.getAllByRole("listitem").map((item) => item.textContent),
    ).toEqual(["Time series", "Gridded data"]);
  });
});
