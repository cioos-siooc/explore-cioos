import { describe, it, expect } from "vitest";

import {
  variablesFrom,
  byColumnName,
} from "../DatasetPreview/previewVariables.js";
import { facetPlanFor } from "../DatasetPreview/previewFacetPlan.js";
import { buildFigure } from "../DatasetPreview/previewFacetFigure.js";

// Does the bundle we actually ship understand the colour axis the figure emits?
//
// The rest of the plot is asserted against buildFigure's return value under
// `node --test`, which is right: a browser is not needed to check an object. But
// that leaves one assumption uncheckable there — that plotly.js-basic-dist-min
// carries the colorscale and colorbar components at all. It is a PARTIAL bundle;
// if a version ever drops them, the figure would keep passing every other test
// and quietly draw no colours at all. So this one file loads the real Plotly and
// asks its own schema.
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
  it("carries a layout colour axis with a scale and a bar", async () => {
    const schema = await plotlySchema();
    const coloraxis = schema.layout.layoutAttributes.coloraxis;
    expect(coloraxis).toBeTruthy();
    expect(Object.keys(coloraxis)).toEqual(
      expect.arrayContaining(["colorscale", "showscale", "colorbar"]),
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
    Object.keys(layout.coloraxis.colorbar).forEach((key) => {
      expect(known.colorbar, `colorbar.${key}`).toHaveProperty(key);
    });
    // Including the time ticks, which are the reason a time column is offerable
    // at all.
    expect(Object.keys(layout.coloraxis.colorbar)).toEqual(
      expect.arrayContaining(["tickmode", "tickvals", "ticktext"]),
    );
    data.forEach((trace) => {
      expect(trace.marker.coloraxis).toBe("coloraxis");
    });
  });
});
