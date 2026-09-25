import { describe, it, expect } from "vitest";

import {
  variablesFrom,
  byColumnName,
} from "../DatasetPreview/previewVariables.js";
import { facetPlanFor } from "../DatasetPreview/previewFacetPlan.js";
import { buildFigure } from "../DatasetPreview/previewFacetFigure.js";

// Does the bundle we actually ship understand what the figure emits?
//
// The rest of the plot is asserted against buildFigure's return value under
// `node --test`, which is right: a browser is not needed to check an object. But
// that leaves the assumptions this file covers uncheckable there — that
// plotly.js-basic-dist-min carries the colour axis and the across-subplot hover
// at all. It is a PARTIAL bundle; if a version ever drops one, the figure would
// keep passing every other test and quietly draw no colours, or answer for one
// panel. So this one file loads the real Plotly and asks its own schema.
//
// It does not render anything: Plotly needs a canvas, and jsdom's getContext
// answers null (src/test/setup.js).

const DATA = Array.from({ length: 10 }, (_, index) => ({
  station_id: "PMZA-RIKI",
  time: `2025-09-16T00:0${index}:00Z`,
  depth: index + 1,
  TE90_01: index * 2,
  PSAL_01: index * 3,
}));

const TABLE = {
  columnNames: ["station_id", "time", "depth", "TE90_01", "PSAL_01"],
  columnTypes: ["String", "String", "float", "float", "float"],
  columnUnits: [null, "UTC", "m", "degree_C", "PSU"],
  columnMeta: [
    { name: "station_id", cf_role: "timeseries_id" },
    { name: "time", axis: "T" },
    { name: "depth", axis: "Z", long_name: "Depth" },
    {
      name: "TE90_01",
      long_name: "Temperature",
      colorBarPalette: "KT_thermal",
    },
    { name: "PSAL_01", long_name: "Salinity" },
  ],
};

function coloredFigure() {
  const dataset = { cdm_data_type: "Profile", first_eov_column: "TE90_01" };
  const variables = variablesFrom(TABLE, dataset);
  return buildFigure({
    plan: facetPlanFor(dataset, variables, DATA),
    variablesByName: byColumnName(variables),
    panels: ["TE90_01", "PSAL_01"],
    sharedAxis: "depth",
    data: DATA,
    colorAxis: "time",
    mode: "markers",
    size: { width: 900, height: 600 },
    uirevision: "test",
  });
}

async function plotlySchema() {
  // Plotly probes `(hover: none)` on import, which the shared matchMedia stub
  // deliberately refuses (it answers width queries only). Nothing here depends
  // on the viewport, so it is stubbed flat for the duration of the import.
  window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
  const Plotly = (await import("plotly.js-basic-dist-min")).default;
  return Plotly.PlotSchema.get();
}

describe("the shipped plotly bundle and the colour dimension", () => {
  it("carries a layout colour axis with a scale and a range", async () => {
    const schema = await plotlySchema();
    const coloraxis = schema.layout.layoutAttributes.coloraxis;
    expect(coloraxis).toBeTruthy();
    expect(Object.keys(coloraxis)).toEqual(
      expect.arrayContaining(["colorscale", "showscale", "cmin", "cmax"]),
    );
    // And a scatter marker can point at it, which is what makes every panel
    // read against the one bar.
    expect(Object.keys(schema.traces.scatter.attributes.marker)).toContain(
      "coloraxis",
    );
  });

  it("understands every key the figure actually sets on it", async () => {
    const schema = await plotlySchema();
    const known = schema.layout.layoutAttributes.coloraxis;
    const { layout, data } = coloredFigure();

    Object.keys(layout.coloraxis).forEach((key) => {
      expect(known, `layout.coloraxis.${key}`).toHaveProperty(key);
    });
    // The bar itself is ours to draw, outside the figure — see
    // ColorScaleLegend.jsx — so the figure states the range instead of leaving
    // it to whatever Plotly would have computed for a bar.
    expect(layout.coloraxis.showscale).toBe(false);
    expect(layout.coloraxis).not.toHaveProperty("colorbar");
    data.forEach((trace) => {
      expect(trace.marker.coloraxis).toBe("coloraxis");
    });
  });
});

describe("the shipped plotly bundle and the axis-wide hover", () => {
  it("can hover every subplot sharing an axis, unified or not", async () => {
    const schema = await plotlySchema();
    const { hoversubplots, hovermode } = schema.layout.layoutAttributes;
    // Its default is "overlaying" — one hovered panel — so the figure has to
    // set this, and the value it sets has to exist.
    expect(hoversubplots.values).toContain("axis");
    // "y unified" is what a profile uses: plain "y" is the one Plotly draws at
    // 60 degrees.
    expect(hovermode.values).toEqual(
      expect.arrayContaining(["x", "y", "y unified"]),
    );
  });

  it("can draw a spike across the panels and title a unified box", async () => {
    const schema = await plotlySchema();
    const axis = schema.layout.layoutAttributes.yaxis;
    expect(axis.showspikes).toBeTruthy();
    // A flaglist: "across" is the flag that spans every panel on the axis
    // rather than stopping at the hovered one.
    expect(axis.spikemode.flags).toContain("across");
    ["spikesnap", "spikethickness", "spikedash", "spikecolor"].forEach(
      (key) => {
        expect(axis, key).toHaveProperty(key);
      },
    );
    // Without this the unified box is titled with the bare axis value.
    expect(axis.unifiedhovertitle).toHaveProperty("text");
  });
});

describe("the shipped plotly bundle and the axis-wide hover", () => {
  it("can hover every subplot sharing an axis", async () => {
    const schema = await plotlySchema();
    const { hoversubplots, hovermode } = schema.layout.layoutAttributes;
    // Its default is "overlaying" — one hovered panel — so the figure has to
    // set this, and the value it sets has to exist.
    expect(hoversubplots.values).toContain("axis");
    expect(hovermode.values).toEqual(expect.arrayContaining(["x", "y"]));
  });

  it("can draw a spike across the panels", async () => {
    const schema = await plotlySchema();
    const axis = schema.layout.layoutAttributes.xaxis;
    expect(axis.showspikes).toBeTruthy();
    // A flaglist: "across" is the flag that spans every panel on the axis
    // rather than stopping at the hovered one.
    expect(axis.spikemode.flags).toContain("across");
    ["spikesnap", "spikethickness", "spikedash", "spikecolor"].forEach(
      (key) => {
        expect(axis, key).toHaveProperty(key);
      },
    );
  });
});
