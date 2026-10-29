import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import { MOBILE_WIDTH, setViewportWidth } from "../../../test/viewport.js";
import Legend from "./Legend.jsx";
import { DEFAULT_DATA_LAYERS } from "../../../state/dataLayers.js";
import { trackLineColor } from "../../config.js";

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

// LegendFooter and TrajectoryDate are real context consumers, so every render
// needs the full "app" provider stack.
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

  it("marks the clicked depth on the depth ramp", () => {
    renderLegend({ zoom: 12, depthReading: { depth: 26.4, resolution: 10 } });
    expect(document.querySelector(".legendDepthMarker")).toBeInTheDocument();
  });

  it("marks nothing where CHS has no sounding, or the bottom dries", () => {
    const { rerender } = renderLegend({
      zoom: 12,
      depthReading: { depth: null, resolution: null },
    });
    expect(document.querySelector(".legendDepthMarker")).toBeNull();
    rerender(
      <Legend
        {...BASE_PROPS}
        zoom={12}
        depthReading={{ depth: -1.5, resolution: 100 }}
      />,
    );
    expect(document.querySelector(".legendDepthMarker")).toBeNull();
  });

  it("drops the depth mark while the depth layer is switched off", () => {
    renderLegend({
      zoom: 12,
      depthReading: { depth: 26.4, resolution: 10 },
      controls: {
        bathymetry: {
          key: "bathymetry",
          label: "Seafloor depth",
          checked: false,
          onChange: () => {},
        },
      },
    });
    expect(document.querySelector(".legendDepthMarker")).toBeNull();
  });

  it("toggles the depth tool from the depth group, and disables it with the layer", () => {
    const onChange = vi.fn();
    const bathymetry = (checked) => ({
      key: "bathymetry",
      label: "Seafloor depth",
      checked,
      onChange: () => {},
    });
    const { rerender } = renderLegend({
      zoom: 12,
      controls: { bathymetry: bathymetry(true) },
      depthTool: { active: false, onChange },
    });
    const tool = screen.getByRole("button", {
      name: "Read the depth at a point",
    });
    expect(tool).toHaveAttribute("aria-pressed", "false");
    tool.click();
    expect(onChange).toHaveBeenCalledWith(true);

    rerender(
      <Legend
        {...BASE_PROPS}
        zoom={12}
        controls={{ bathymetry: bathymetry(true) }}
        depthTool={{ active: true, onChange }}
      />,
    );
    expect(tool).toHaveAttribute("aria-pressed", "true");
    tool.click();
    expect(onChange).toHaveBeenLastCalledWith(false);

    rerender(
      <Legend
        {...BASE_PROPS}
        zoom={12}
        controls={{ bathymetry: bathymetry(false) }}
        depthTool={{ active: false, onChange }}
      />,
    );
    expect(tool).toBeDisabled();
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

  it("says in the seafloor info that NONNA is not for navigation", async () => {
    const { user } = renderLegend({ zoom: 12 });
    await user.click(screen.getByLabelText("About Seafloor depth"));
    const help = await screen.findByTestId("legend-help-modal");
    expect(help).toHaveTextContent("Not for navigation");
    expect(help).toHaveTextContent("official CHS nautical charts");
    expect(help).toHaveTextContent("below chart datum");
    expect(help).toHaveTextContent("The crosshair button");
    expect(help).toHaveTextContent("Press Esc or the crosshair again");
  });

  it("explains the metric from the info button on the group label", async () => {
    const { user } = renderLegend();
    await user.click(screen.getByLabelText("About Days of data"));
    const help = await screen.findByTestId("legend-help-modal");
    expect(help).toHaveTextContent("the distinct days on which anything was");
    expect(help).toHaveTextContent("A day counts once");
  });

  it("folds the hexes into the metric explainer and gives markers their own", async () => {
    const { user } = renderLegend({ zoom: 10 });
    await user.click(screen.getByLabelText("About Days of data"));
    expect(await screen.findByTestId("legend-help-modal")).toHaveTextContent(
      "Hover for what is inside",
    );
    await user.click(screen.getByLabelText("Close"));
    await user.click(screen.getByLabelText("About Markers"));
    const markers = await screen.findByTestId("legend-help-modal");
    expect(markers).toHaveTextContent("stop being cells");
    expect(markers).toHaveTextContent("Colour is the platform");
  });

  it("shows the map's own position marker beside its entry in the trajectories explainer", async () => {
    const { user } = renderLegend({
      dataLayers: { ...DEFAULT_DATA_LAYERS, trajectories: true },
    });
    await user.click(screen.getByLabelText("About Trajectories"));
    const help = await screen.findByTestId("legend-help-modal");
    expect(help).toHaveTextContent("Position on date");
    expect(help.querySelector(`path[fill="${trackLineColor}"]`)).not.toBeNull();
    const icons = help.querySelectorAll(
      ".helpModalTitleIcon .bi, .helpModalItemIcon .bi",
    );
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect(icon).toHaveAttribute("fill", trackLineColor);
    }
  });

  it("gives the keyless layers group an info button of its own", async () => {
    const { user } = renderLegend({
      layerControls: [
        {
          key: "griddap",
          label: "Gridded coverage",
          checked: false,
          onChange: vi.fn(),
        },
      ],
    });
    await user.click(screen.getByLabelText("About Gridded data coverage"));
    expect(await screen.findByTestId("legend-help-modal")).toHaveTextContent(
      "What it draws",
    );
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
