import * as React from "react";
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import ColorScaleLegend from "./ColorScaleLegend.jsx";
import { buildFigure } from "../DatasetPreview/previewFacetFigure.js";
import {
  byColumnName,
  variablesFrom,
} from "../DatasetPreview/previewVariables.js";
import { facetPlanFor } from "../DatasetPreview/previewFacetPlan.js";

// The strip is fed by buildFigure's `colorLegend` and by nothing else, so it is
// built here from a real figure: a legend painting stops the markers were not
// given is the failure this guards against.
const TABLE = {
  columnNames: ["depth", "temperature", "salinity"],
  columnTypes: ["float", "float", "float"],
  columnUnits: ["m", "degree_C", "PSU"],
};
const DATASET = { cdm_data_type: "Profile", first_eov_column: "temperature" };
const DATA = [
  { depth: 0, temperature: 10, salinity: 30 },
  { depth: 5, temperature: 9, salinity: 34 },
];

function legendFrom(colorAxis) {
  const variables = variablesFrom(TABLE, DATASET);
  const variablesByName = byColumnName(variables);
  const plan = facetPlanFor(DATASET, variables, DATA);
  return buildFigure({
    plan,
    variablesByName,
    panels: ["temperature"],
    sharedAxis: plan.sharedAxis,
    data: DATA,
    colorAxis,
    uirevision: "test",
  }).colorLegend;
}

describe("ColorScaleLegend", () => {
  it("renders nothing when no column carries the colour dimension", () => {
    const { container } = renderWithProviders(
      <ColorScaleLegend legend={legendFrom(null)} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("names the column and ticks the range the markers were mapped over", () => {
    const legend = legendFrom("salinity");
    renderWithProviders(<ColorScaleLegend legend={legend} />);

    expect(screen.getByText("salinity ( PSU )")).toBeInTheDocument();
    // The ends of the ramp are the record's own extent, not the catalogue's.
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.getByText("34")).toBeInTheDocument();
  });

  it("paints the gradient from the same stops the figure gave the markers", () => {
    const legend = legendFrom("salinity");
    const { container } = renderWithProviders(
      <ColorScaleLegend legend={legend} />,
    );

    // jsdom re-serialises a hex colour as rgb(), so the comparison is made in
    // whichever form it kept.
    const asRgb = (hex) => {
      const [, r, g, b] = /^#(..)(..)(..)$/.exec(hex);
      return `rgb(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)})`;
    };

    const painted = container.querySelector(".colorScaleLegendBar").style
      .backgroundImage;
    expect(painted).toContain(asRgb(legend.stops[0][1]));
    expect(painted).toContain(asRgb(legend.stops[legend.stops.length - 1][1]));
  });

  it("pulls the end ticks inward so they do not hang off the ramp", () => {
    const legend = legendFrom("salinity");
    const { container } = renderWithProviders(
      <ColorScaleLegend legend={legend} />,
    );

    const ticks = [...container.querySelectorAll(".colorScaleLegendTick")];
    expect(ticks[0].className).toContain("start");
    expect(ticks[ticks.length - 1].className).toContain("end");
    expect(ticks[1].className).toContain("mid");
  });
});
