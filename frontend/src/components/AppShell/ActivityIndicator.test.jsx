import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

let selection;

vi.mock("../../state/activity/ActivityProvider.jsx", () => ({
  useActivity: () => ({
    labelKeys: ["activityRecordText"],
    busy: true,
    announced: true,
  }),
}));
vi.mock("../../state/map/MapStateProvider.jsx", () => ({
  useMapView: () => ({ firstPaintPending: false }),
}));
vi.mock("../../state/selection/SelectionProvider.jsx", () => ({
  useSelection: () => selection,
}));

import ActivityIndicator from "./ActivityIndicator.jsx";

const panel = () => document.querySelector(".activityStatus");

describe("ActivityIndicator", () => {
  beforeEach(() => {
    selection = { showPreviewModal: false, recordLoading: false };
  });

  it("shows the panel while work is announced", () => {
    render(<ActivityIndicator />);
    expect(panel()).toBeInTheDocument();
  });

  it("leaves a loading preview to the modal's own loading screen", () => {
    selection = { showPreviewModal: true, recordLoading: true };
    render(<ActivityIndicator />);
    expect(panel()).not.toBeInTheDocument();
    // Still spoken: the panel only stands down visually.
    expect(screen.getByRole("status")).toHaveTextContent("activityRecordText");
  });

  it("comes back once the preview has loaded", () => {
    selection = { showPreviewModal: true, recordLoading: false };
    render(<ActivityIndicator />);
    expect(panel()).toBeInTheDocument();
  });
});
