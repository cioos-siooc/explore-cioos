import * as React from "react";
import { describe, it, expect, vi } from "vitest";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import platformColors from "../../platformColors";
import CoverageHistogramPlot from "./CoverageHistogramPlot.jsx";

// Plotly needs a real canvas; the traces handed to it are what is under test.
const plotProps = vi.fn();
vi.mock("react-plotly.js/factory", () => ({
  default: () => (props) => {
    plotProps(props);
    return null;
  },
}));
vi.mock("plotly.js-basic-dist-min", () => ({ default: { register: vi.fn() } }));

const colorOf = (platform) =>
  platformColors.find((pc) => pc.platform === platform).color;

function traces(series) {
  plotProps.mockClear();
  renderWithProviders(
    <CoverageHistogramPlot
      histogram={{
        count: "datasets",
        timeBinEdges: ["2000-01-01T00:00:00Z", "2001-01-01T00:00:00Z"],
        series,
        cells: series.map(({ key }) => [1, key, 1]),
      }}
    />,
  );
  return plotProps.mock.lastCall[0].data;
}

const traceColors = (series) =>
  traces(series).map((trace) => trace.marker.color);

describe("CoverageHistogramPlot", () => {
  it("names data-type series the way the geometry filter does", () => {
    const names = traces([
      { key: "TimeSeries", kind: "dataType" },
      { key: "Grid", kind: "dataType" },
    ]).map((trace) => trace.name);
    expect(names).toEqual(["Time series", "Gridded data"]);
  });

  it("paints each platform in its map colour whatever its rank", () => {
    const colors = traceColors([
      { key: "surface vessel", kind: "platform" },
      { key: "mooring", kind: "platform" },
    ]);
    expect(colors).toEqual([colorOf("surface vessel"), colorOf("mooring")]);
  });

  it("gives an unkeyed platform a palette slot rather than the unknown grey", () => {
    const [unkeyed, mooring] = traceColors([
      { key: "autonomous underwater vehicle", kind: "platform" },
      { key: "mooring", kind: "platform" },
    ]);
    expect(unkeyed).not.toBe(colorOf("unknown"));
    expect(mooring).toBe(colorOf("mooring"));
  });

  it("colours other groupings by palette slot, never a platform colour", () => {
    const colors = traceColors([
      { key: "Hakai", kind: "organization" },
      { key: "mooring", kind: "organization" },
    ]);
    expect(new Set(colors).size).toBe(2);
    expect(colors[1]).not.toBe(colorOf("mooring"));
  });

  it("labels seasonal bars by week of the year, with no year", () => {
    plotProps.mockClear();
    renderWithProviders(
      <CoverageHistogramPlot
        histogram={{
          count: "days",
          view: "seasonal",
          timeBinEdges: ["2001-12-24T00:00:00Z", "2002-01-01T00:00:00Z"],
          series: [{ key: "Hakai", kind: "organization" }],
          cells: [[1, "Hakai", 3]],
        }}
      />,
    );
    const { data, layout } = plotProps.mock.lastCall[0];
    expect(data[0].customdata[0]).toContain("<b>Dec 24 – Dec 31</b>");
    expect(layout.xaxis.tickformat).toBe("%b");
  });
});
