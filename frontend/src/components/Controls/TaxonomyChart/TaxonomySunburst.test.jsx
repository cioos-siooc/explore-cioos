import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { SUNBURST_ROOT_ID, buildTaxonomyTree } from "./taxonomy.js";
import TaxonomySunburst from "./TaxonomySunburst.jsx";

// Plotly needs a real canvas; the props handed to it are what is under test.
const plotProps = vi.fn();
const graphDiv = {};
vi.mock("react-plotly.js/factory", () => ({
  default: () => (props) => {
    plotProps(props);
    const { onInitialized } = props;
    React.useEffect(() => onInitialized({}, graphDiv), [onInitialized]);
    return null;
  },
}));
const animate = vi.fn();
vi.mock("plotly.js/lib/core", () => ({
  default: { register: vi.fn(), animate: (...args) => animate(...args) },
}));
vi.mock("plotly.js/lib/sunburst", () => ({ default: {} }));

const TREE = buildTaxonomyTree([
  { kingdom: "Animalia", phylum: "Chordata", class: "Teleostei", records: 5 },
  { kingdom: "Animalia", phylum: "Mollusca", records: 2 },
]);

function sunburstClick(event) {
  act(() => plotProps.mock.lastCall[0].onSunburstClick(event));
}

describe("TaxonomySunburst", () => {
  beforeEach(() => {
    plotProps.mockClear();
    animate.mockClear();
  });

  it("offers Show all only once a sector has been zoomed into", () => {
    renderWithProviders(<TaxonomySunburst tree={TREE} />);
    const showAll = screen.getByRole("button", { name: "Show all" });
    expect(showAll).toBeDisabled();

    sunburstClick({ nextLevel: "Animalia/Chordata" });
    expect(showAll).toBeEnabled();

    sunburstClick({ nextLevel: SUNBURST_ROOT_ID });
    expect(showAll).toBeDisabled();
  });

  it("ignores clicks that don't zoom", () => {
    renderWithProviders(<TaxonomySunburst tree={TREE} />);
    sunburstClick({ nextLevel: "Animalia/Chordata" });
    sunburstClick({});
    expect(screen.getByRole("button", { name: "Show all" })).toBeEnabled();
  });

  it("animates back to the root", async () => {
    const { user } = renderWithProviders(<TaxonomySunburst tree={TREE} />);
    sunburstClick({ nextLevel: "Animalia/Chordata" });

    await user.click(screen.getByRole("button", { name: "Show all" }));

    expect(animate).toHaveBeenCalledWith(
      graphDiv,
      { data: [{ level: SUNBURST_ROOT_ID }], traces: [0] },
      expect.any(Object),
    );
    expect(screen.getByRole("button", { name: "Show all" })).toBeDisabled();
  });
});
