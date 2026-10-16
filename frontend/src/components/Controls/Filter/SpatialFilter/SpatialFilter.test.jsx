import * as React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../../test/mockFetch.js";
import { useMapState } from "../../../../state/map/MapStateProvider.jsx";
import { useUI } from "../../../../state/ui/UIProvider.jsx";
import { polygonIsRectangle } from "../../../../utilities.jsx";
import SpatialFilter from "./SpatialFilter.jsx";

const square = [
  [
    [-67, 44],
    [-64, 44],
    [-64, 46],
    [-67, 46],
    [-67, 44],
  ],
];
const place = (featureid, name, concise, geometry) => ({
  type: "Feature",
  properties: { featureid, name, concise },
  geometry,
});
const reply = {
  type: "FeatureCollection",
  features: [
    place("fundy", "Bay of Fundy", "BAY", {
      type: "MultiPolygon",
      coordinates: [square],
    }),
    place("fundian", "Fundian Channel", "SEAU", {
      type: "MultiPoint",
      coordinates: [[-65.5, 42.5]],
    }),
  ],
};

describe("SpatialFilter place search", () => {
  beforeEach(() => {
    installMockFetch();
    const fallback = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, init) =>
        String(input).startsWith("https://geogratis.gc.ca/")
          ? new Response(JSON.stringify(reply), { status: 200 })
          : fallback(input, init),
      ),
    );
  });

  async function renderPanel() {
    const seen = {};
    function Probe() {
      const map = useMapState();
      seen.draw = map.drawRequest?.mode;
      seen.ring = map.drawRequest?.ring;
      seen.zoom = map.zoomTarget?.geometry;
      const ui = useUI();
      seen.showFiltersModal = ui.showFiltersModal;
      seen.setShowFiltersModal = ui.setShowFiltersModal;
      return null;
    }
    const user = userEvent.setup({ delay: null });
    renderWithProviders(
      <>
        <SpatialFilter />
        <Probe />
      </>,
      { providers: "app" },
    );
    await waitFor(() => expect(seen.setShowFiltersModal).toBeDefined());
    await user.type(screen.getByTestId("spatial-filter-place-input"), "fundy");
    await screen.findByText("Bay of Fundy");
    return { user, seen };
  }

  it("goes to a place without filtering, and closes the modal", async () => {
    const { user, seen } = await renderPanel();

    await user.click(
      screen.getByRole("button", { name: "Go to: Bay of Fundy" }),
    );

    expect(seen.zoom.type).toBe("MultiPolygon");
    expect(seen.draw).toBeUndefined();
    expect(seen.showFiltersModal).toBe(false);
  });

  it("filters by an area's outline or box", async () => {
    const { user, seen } = await renderPanel();

    await user.click(
      screen.getByRole("button", {
        name: "Filter by Bounding box: Bay of Fundy",
      }),
    );
    await waitFor(() => expect(seen.draw).toBe("shape"));
    expect(polygonIsRectangle(seen.ring)).toBe(true);

    await user.click(
      screen.getByRole("button", { name: "Filter by Polygon: Bay of Fundy" }),
    );
    await waitFor(() => expect(polygonIsRectangle(seen.ring)).toBe(false));
  });

  it("offers a point place only to go to", async () => {
    await renderPanel();

    expect(
      screen.getByRole("button", { name: "Go to: Fundian Channel" }),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("spatial-filter-place-box")).toHaveLength(1);
  });
});
