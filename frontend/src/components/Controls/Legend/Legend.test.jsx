import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import { MOBILE_WIDTH, setViewportWidth } from "../../../test/viewport.js";
import Legend from "./Legend.jsx";
import { DEFAULT_DATA_LAYERS } from "../../../state/dataLayers.js";

const BASE_PROPS = {
  currentRangeLevel: [1, 100],
  hexRangeLevel: [1, 500],
  loading: false,
  zoom: 4,
  platformsAvailable: ["mooring"],
  controls: {},
  layerControls: [],
  dataLayers: DEFAULT_DATA_LAYERS,
};

// Legend always mounts LegendFooter (the scale bar / credits, backed by
// MapStateProvider's mapInstance) and, once a trajectory layer is on, the
// TrajectoryDate group — both real context consumers — so every render needs
// the full "app" provider stack, not just i18n/router.
function renderLegend(props) {
  return renderWithProviders(<Legend {...BASE_PROPS} {...props} />, {
    providers: "app",
  });
}

describe("Legend", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("renders the title and the hex ramp when a hex range is available", () => {
    renderLegend();
    expect(screen.getByText("Legend")).toBeInTheDocument();
    expect(document.querySelector(".legendColorBar")).toBeInTheDocument();
    expect(screen.getByText("Days of data")).toBeInTheDocument();
  });

  it("shows a loading state instead of the ramp while /legend is in flight with no prior data", () => {
    renderLegend({ hexRangeLevel: undefined, loading: true });
    expect(screen.getByText("Loading legend…")).toBeInTheDocument();
    expect(document.querySelector(".legendColorBar")).not.toBeInTheDocument();
  });

  it("shows a no-data warning once loading has settled with nothing to show", () => {
    renderLegend({ hexRangeLevel: undefined, loading: false });
    expect(screen.getByText("No Data")).toBeInTheDocument();
  });

  it("shows marker keys, including platform swatches, at the marker-tier zoom", () => {
    renderLegend({ zoom: 10 });
    expect(screen.getByText("Markers")).toBeInTheDocument();
    expect(screen.getByText("Platform type")).toBeInTheDocument();
    expect(screen.getByText("Mooring")).toBeInTheDocument();
  });

  it("clicking the header collapses the body, and clicking again reopens it", async () => {
    const { user } = renderLegend();
    const header = screen.getByTitle("Close legend");
    expect(document.querySelector(".legendBody")).toBeInTheDocument();
    await user.click(header);
    expect(document.querySelector(".legendBody")).not.toBeInTheDocument();
    await user.click(screen.getByTitle("Open legend"));
    expect(document.querySelector(".legendBody")).toBeInTheDocument();
  });

  it("a group's switch calls onChange when toggled", async () => {
    const onChange = vi.fn();
    const { user } = renderLegend({
      controls: {
        observations: {
          key: "observations",
          checked: true,
          label: "Observations",
          onChange,
        },
      },
    });
    await user.click(document.querySelector("#mapLayer-observations"));
    expect(onChange).toHaveBeenCalled();
  });

  it("renders the bathymetry ramp only once zoomed to its minimum legend zoom", () => {
    const { rerender } = renderLegend({ zoom: 2 });
    expect(screen.queryByText("Depth (m)")).not.toBeInTheDocument();
    rerender(<Legend {...BASE_PROPS} zoom={10} />);
    expect(screen.getByText("Depth (m)")).toBeInTheDocument();
  });

  it("renders layer switches with no key on the map under their own group", () => {
    const onChange = vi.fn();
    renderLegend({
      layerControls: [
        { key: "griddap", label: "Gridded coverage", checked: false, onChange },
      ],
    });
    expect(screen.getByLabelText("Gridded coverage")).toBeInTheDocument();
  });

  it("on a phone-width viewport, collapses to a compact ramp and opens the rest behind a dialog", async () => {
    setViewportWidth(MOBILE_WIDTH);
    const { user } = renderLegend();
    expect(document.querySelector(".legendCompactRamp")).toBeInTheDocument();
    await user.click(screen.getByTitle("Open legend"));
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });
});
