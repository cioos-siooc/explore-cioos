import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const zoomToGeometry = vi.fn();
let inspectDataset;

vi.mock("../../../state/selection/SelectionProvider.jsx", () => ({
  useSelection: () => ({ inspectDataset }),
}));
vi.mock("../../../state/map/MapStateProvider.jsx", () => ({
  useMapState: () => ({ zoomToGeometry, mapInstance: null, mapView: null }),
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

describe("ZoomToDataset", () => {
  beforeEach(() => zoomToGeometry.mockClear());

  it("frames the dataset's footprint when the map isn't already on it", async () => {
    inspectDataset = { coverage_bbox_geojson: footprint };
    render(<ZoomToDataset />);
    const button = screen.getByRole("button");
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(zoomToGeometry).toHaveBeenCalledWith(footprint);
  });

  it("is disabled for a dataset with no footprint", () => {
    inspectDataset = {};
    render(<ZoomToDataset />);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
