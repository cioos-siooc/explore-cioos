import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../test/mockFetch.js";
import { useMapState } from "./MapStateProvider.jsx";
import { useSelection } from "../selection/SelectionProvider.jsx";
import legendFixture from "../../../e2e/fixtures/api/legend.json";

let latest;

function Probe() {
  latest = useMapState();
  // SelectionProvider's own initial /pointQuery load, once it settles,
  // recomputes hiddenDatasetPks and — seeing nothing hidden — calls
  // setMapDatasetPKs(undefined) via its own effect. Under enough load that
  // load can still be in flight after legendLoading clears, and would land
  // AFTER (and silently clobber) a value this suite sets on mapDatasetPKs —
  // wait for both loads, not just the legend's.
  const { initialPointsQueryComplete } = useSelection();
  const ready = !latest.legendLoading && initialPointsQueryComplete;
  return <span data-testid="state">{ready ? "ready" : "loading"}</span>;
}

async function renderReady(options) {
  renderWithProviders(<Probe />, { providers: "app", ...options });
  await waitFor(() =>
    expect(screen.getByTestId("state")).toHaveTextContent("ready"),
  );
}

describe("MapStateProvider", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("loads /legend and exposes the fixture's recordsCount", async () => {
    await renderReady();
    expect(latest.rangeLevels).toEqual(legendFixture.recordsCount);
  });

  it("picks the zoom0/zoom1/zoom2 tier by the current zoom", async () => {
    await renderReady({ url: "/?zoom=3" });
    expect(latest.currentRangeLevel).toEqual(legendFixture.recordsCount.zoom0);

    act(() => latest.setMapView({ ...latest.mapView, zoom: 6 }));
    await waitFor(() =>
      expect(latest.currentRangeLevel).toEqual(legendFixture.recordsCount.zoom1),
    );

    act(() => latest.setMapView({ ...latest.mapView, zoom: 10 }));
    await waitFor(() =>
      expect(latest.currentRangeLevel).toEqual(legendFixture.recordsCount.zoom2),
    );
  });

  it("seeds the camera from ?lat&lon&zoom, defaulting anything absent", async () => {
    await renderReady({ url: "/?lat=48.5&lon=-125&zoom=8" });
    expect(latest.mapView).toEqual({ lat: 48.5, lon: -125, zoom: 8 });
  });

  it("defaults bathymetry/observations/projection switches to on/on/mercator", async () => {
    await renderReady();
    expect(latest.bathymetryVisible).toBe(true);
    expect(latest.dataLayersVisible).toBe(true);
    expect(latest.projection).toBe("mercator");
  });

  it("seeds bathymetry/observations/projection switches from the URL", async () => {
    await renderReady({ url: "/?bathy=false&obs=false&globe=true" });
    expect(latest.bathymetryVisible).toBe(false);
    expect(latest.dataLayersVisible).toBe(false);
    expect(latest.projection).toBe("globe");
  });

  it("defaults tracksMode on", async () => {
    await renderReady();
    expect(latest.tracksMode).toBe(true);
  });

  it("honours an explicit tracks=false", async () => {
    await renderReady({ url: "/?tracks=false" });
    expect(latest.tracksMode).toBe(false);
  });

  it("toggleTrackLines flips tracksMode", async () => {
    await renderReady();
    act(() => latest.toggleTrackLines());
    expect(latest.tracksMode).toBe(false);
  });

  it("defaults dataLayers to everything on", async () => {
    await renderReady();
    expect(Object.values(latest.dataLayers).every(Boolean)).toBe(true);
  });

  it("seeds dataLayers from a ?layers= share link", async () => {
    await renderReady({ url: "/?layers=profile,timeseries" });
    expect(latest.dataLayers.profile).toBe(true);
    expect(latest.dataLayers.timeseries).toBe(true);
    expect(latest.dataLayers.grid).toBe(false);
  });

  it("toggleDataLayer narrows to one layer from the everything-on default", async () => {
    await renderReady();
    act(() => latest.toggleDataLayer("grid"));
    expect(latest.dataLayers.grid).toBe(true);
    expect(latest.dataLayers.profile).toBe(false);
  });

  it("resetDataLayers restores the everything-on default", async () => {
    await renderReady();
    act(() => latest.toggleDataLayer("grid"));
    act(() => latest.resetDataLayers());
    expect(Object.values(latest.dataLayers).every(Boolean)).toBe(true);
  });

  it("fetches /griddapCoverage only once the layer is switched on", async () => {
    await renderReady();
    expect(latest.griddapCoverage).toBeUndefined();

    act(() => latest.setGriddapCoverageVisible(true));
    await waitFor(() =>
      expect(latest.griddapCoverage).toEqual({
        type: "FeatureCollection",
        features: [],
      }),
    );
  });

  it("zoomToGeometry sets a zoomTarget carrying the geometry and a fresh nonce", async () => {
    await renderReady();
    const geometry = { type: "Point", coordinates: [0, 0] };
    act(() => latest.zoomToGeometry(geometry));
    expect(latest.zoomTarget.geometry).toBe(geometry);
    expect(latest.zoomTarget.nonce).toBeTypeOf("number");
  });

  it("requestDraw sets a drawRequest carrying the mode", async () => {
    await renderReady();
    act(() => latest.requestDraw("box"));
    expect(latest.drawRequest.mode).toBe("box");
  });

  it("narrows mapQueryString's datasetPKs to mapDatasetPKs, when set", async () => {
    await renderReady();
    const withoutHidden = latest.mapQueryString;
    act(() => latest.setMapDatasetPKs([1, 2]));
    await waitFor(() => {
      expect(new URLSearchParams(latest.mapQueryString).get("datasetPKs")).toBe(
        "1,2",
      );
    });
    expect(latest.mapQueryString).not.toBe(withoutHidden);
  });
});
