import * as React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../../test/mockFetch.js";
import { useMapState } from "../../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../../state/selection/SelectionProvider.jsx";
import { useUI } from "../../../../state/ui/UIProvider.jsx";
import { polygonIsRectangle } from "../../../../utilities.jsx";
import QuickFilters from "../../../AppShell/QuickFilters/QuickFilters.jsx";
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
  properties: { featureid, cgndbid: featureid.toUpperCase(), name, concise },
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
  // The q of each GeoNames request; `answer(q)` is what it gets back.
  let queries;
  let answer;
  beforeEach(() => {
    installMockFetch();
    queries = [];
    answer = () => reply;
    const fallback = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, init) => {
        const url = new URL(String(input), "http://localhost");
        if (url.hostname !== "geogratis.gc.ca") return fallback(input, init);
        const q = url.searchParams.get("q");
        queries.push(q);
        return new Response(JSON.stringify(answer(q)), { status: 200 });
      }),
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
      // The map's part: a requested shape becomes the area filter.
      const { setPolygon } = useSelection();
      seen.setPolygon = setPolygon;
      const { drawRequest } = map;
      React.useEffect(() => {
        if (drawRequest?.mode === "shape") setPolygon(drawRequest.ring);
      }, [drawRequest, setPolygon]);
      return null;
    }
    const user = userEvent.setup({ delay: null });
    renderWithProviders(
      <>
        <SpatialFilter />
        <QuickFilters />
        <Probe />
      </>,
      { providers: "app" },
    );
    await waitFor(() => expect(seen.setShowFiltersModal).toBeDefined());
    await user.type(screen.getByTestId("spatial-filter-place-input"), "fundy");
    await screen.findByText("Bay of Fundy");
    return { user, seen };
  }

  it("matches the last word as it is typed", async () => {
    await renderPanel();

    expect(queries.at(-1)).toBe("fundy*");
  });

  it("searches the words as written when the typed prefix finds nothing", async () => {
    answer = (q) => (q.endsWith("*") ? { features: [] } : reply);
    await renderPanel();

    expect(queries.slice(-2)).toEqual(["fundy*", "fundy"]);
  });

  it("shows a spinner while waiting for NRCan", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<SpatialFilter />, { providers: "app" });

    await user.type(screen.getByTestId("spatial-filter-place-input"), "fun");

    expect(screen.getByRole("status")).toHaveTextContent("Searching places…");
    await screen.findByText("Bay of Fundy");
    expect(screen.queryByText("Searching places…")).toBeNull();
  });

  it("names a picked area and links its NRCan record, until it is edited", async () => {
    const { user, seen } = await renderPanel();

    await user.click(
      screen.getByRole("button", { name: "Filter by Polygon: Bay of Fundy" }),
    );

    const record = await screen.findByTestId("spatial-filter-place-record");
    expect(record).toHaveAttribute(
      "href",
      "https://geogratis.gc.ca/services/geoname/en/geonames/FUNDY.html",
    );
    expect(record.closest("p")).toHaveTextContent("Bay of Fundy");
    expect(screen.getByTestId("quick-filter-area")).toHaveAccessibleName(
      "Draw area: Bay of Fundy",
    );

    act(() => seen.setPolygon([...seen.ring]));
    expect(screen.queryByTestId("spatial-filter-place-record")).toBeNull();
  });

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
    expect(screen.getAllByTestId("spatial-filter-place-area")).toHaveLength(1);
    expect(screen.getAllByTestId("spatial-filter-place-point")).toHaveLength(1);
  });
});

describe("SpatialFilter coordinates", () => {
  beforeEach(() => {
    installMockFetch();
  });

  function renderPanel(url = "/") {
    const seen = {};
    function Probe() {
      const map = useMapState();
      seen.ring = map.drawRequest?.ring;
      seen.showFiltersModal = useUI().showFiltersModal;
      const { setPolygon } = useSelection();
      const { drawRequest } = map;
      React.useEffect(() => {
        if (drawRequest?.mode === "shape") setPolygon(drawRequest.ring);
      }, [drawRequest, setPolygon]);
      return null;
    }
    const user = userEvent.setup({ delay: null });
    renderWithProviders(
      <>
        <SpatialFilter />
        <Probe />
      </>,
      { url, providers: "app" },
    );
    return { user, seen };
  }

  it("starts from the current box, and applies the edited one", async () => {
    const { user, seen } = renderPanel(
      "/?latMin=44&lonMin=-67&latMax=46&lonMax=-64",
    );
    const north = screen.getByTestId("spatial-filter-north");
    expect(north).toHaveValue(46);

    await user.clear(north);
    await user.type(north, "47.5");
    await user.click(
      screen.getByRole("button", { name: "Apply bounding box filter" }),
    );

    await waitFor(() => expect(seen.ring).toBeDefined());
    expect(polygonIsRectangle(seen.ring)).toBe(true);
    expect(Math.max(...seen.ring.map(([, lat]) => lat))).toBe(47.5);
    expect(seen.showFiltersModal).toBe(false);
  });

  it("explains an impossible box instead of applying it", async () => {
    const { user, seen } = renderPanel();

    await user.type(screen.getByTestId("spatial-filter-west"), "-60");
    await user.type(screen.getByTestId("spatial-filter-east"), "-70");
    await user.type(screen.getByTestId("spatial-filter-south"), "40");
    await user.type(screen.getByTestId("spatial-filter-north"), "50");
    await user.click(
      screen.getByRole("button", { name: "Apply bounding box filter" }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "West must be less than east",
    );
    expect(screen.getByTestId("spatial-filter-west")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(seen.ring).toBeUndefined();
  });

  it("applies a pasted wkt polygon, and refuses one it cannot read", async () => {
    const { user, seen } = renderPanel();
    const wkt = screen.getByTestId("spatial-filter-wkt");

    await user.click(wkt);
    await user.paste("POLYGON((-67 44, -64 44))");
    await user.click(
      screen.getByRole("button", { name: "Apply polygon filter" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("POLYGON((lon lat");

    await user.clear(wkt);
    expect(screen.queryByRole("alert")).toBeNull();
    await user.paste("POLYGON((-67 44, -64 44, -65 46, -67 44))");
    await user.click(
      screen.getByRole("button", { name: "Apply polygon filter" }),
    );
    await waitFor(() => expect(seen.ring).toHaveLength(4));
    expect(screen.getByTestId("spatial-filter-wkt")).toHaveValue(
      "POLYGON((-67 44, -64 44, -65 46, -67 44))",
    );
  });
});
