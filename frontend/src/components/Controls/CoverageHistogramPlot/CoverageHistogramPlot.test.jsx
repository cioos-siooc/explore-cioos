import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

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

function traceColors(series) {
  plotProps.mockClear();
  render(
    <CoverageHistogramPlot
      histogram={{
        count: "datasets",
        timeBinEdges: ["2000-01-01T00:00:00Z", "2001-01-01T00:00:00Z"],
        series,
        cells: series.map(({ key }) => [1, key, 1]),
      }}
    />,
  );
  return plotProps.mock.lastCall[0].data.map((trace) => trace.marker.color);
}

describe("CoverageHistogramPlot", () => {
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
});
