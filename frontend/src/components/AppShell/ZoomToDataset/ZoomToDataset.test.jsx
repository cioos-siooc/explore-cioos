import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";

const zoomToGeometry = vi.fn();
let inspectDataset;

vi.mock("../../../state/selection/SelectionProvider.jsx", () => ({
  useSelection: () => ({ inspectDataset }),
}));
vi.mock("../../../state/map/MapStateProvider.jsx", () => ({
  useMapState: () => ({ zoomToGeometry, mapInstance: null }),
  useMapView: () => ({ mapView: null }),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k) => k }) }));

import ZoomToDataset from "./ZoomToDataset.jsx";

const footprint = {
  type: "Polygon",
  coordinates: [
    [
      [-64, 44],
      [-63, 44],
      [-63, 45],
      [-64, 45],
      [-64, 44],
    ],
  ],
};

let search;
function LocationProbe() {
  search = useLocation().search;
  return null;
}

const renderAt = (url = "/") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ZoomToDataset />
      <LocationProbe />
    </MemoryRouter>,
  );

describe("ZoomToDataset", () => {
  beforeEach(() => zoomToGeometry.mockClear());

  it("frames the dataset's footprint when the map isn't already on it", async () => {
    inspectDataset = { coverage_bbox_geojson: footprint };
    renderAt();
    const button = screen.getByRole("button");
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(zoomToGeometry).toHaveBeenCalledWith(footprint);
  });

  it("is disabled for a dataset with no footprint", () => {
    inspectDataset = {};
    renderAt();
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("returns a widened page to the sidebar so the map can be seen", async () => {
    inspectDataset = { coverage_bbox_geojson: footprint };
    renderAt("/?dataset=1&wide=1");
    await userEvent.click(screen.getByRole("button"));
    expect(search).not.toContain("wide=");
    expect(search).toContain("dataset=1");
  });
});
