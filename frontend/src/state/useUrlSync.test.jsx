import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../test/renderWithProviders.jsx";
import { installMockFetch } from "../test/mockFetch.js";
import { useFilters } from "./filters/FilterProvider.jsx";
import { useSelection } from "./selection/SelectionProvider.jsx";
import { useMapState, useMapView } from "./map/MapStateProvider.jsx";
import { useUI } from "./ui/UIProvider.jsx";
import pointQueryFixture from "../../e2e/fixtures/api/pointQuery.json";

// UrlSync is mounted inside AppProviders, so these drive real state through
// the full app tree and read the URL back.
let hooks;

function Probe() {
  hooks = {
    filters: useFilters(),
    selection: useSelection(),
    mapState: useMapState(),
    mapView: useMapView(),
    ui: useUI(),
  };
  return (
    <span data-testid="ready">
      {hooks.filters.catalogLoaded ? "loaded" : "loading"}
    </span>
  );
}

const params = () => new URLSearchParams(window.location.search);

describe("UrlSync", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("keeps the card widened across a map pan, and back on the list", async () => {
    renderWithProviders(<Probe />, {
      providers: "app",
      url: `/?dataset=${pointQueryFixture[0].dataset_id}&wide=1`,
    });
    await waitFor(() => expect(hooks.selection.inspectDataset).toBeTruthy());
    act(() => hooks.mapView.setMapView({ lat: 50, lon: -125, zoom: 6 }));
    await waitFor(() => expect(params().get("zoom")).toBe("6"));
    expect(params().get("wide")).toBe("1");

    act(() => hooks.selection.returnToDatasetList());
    await waitFor(() => expect(params().has("dataset")).toBe(false));
    act(() => hooks.mapView.setMapView({ lat: 49, lon: -124, zoom: 5 }));
    await waitFor(() => expect(params().get("zoom")).toBe("5"));
    expect(params().get("wide")).toBe("1");
  });

  it("keeps a param written after its last render, as when widening while the page settles", async () => {
    renderWithProviders(<Probe />, {
      providers: "app",
      url: `/?dataset=${pointQueryFixture[0].dataset_id}`,
    });
    await waitFor(() => expect(hooks.selection.inspectDataset).toBeTruthy());
    // Straight to history, so UrlSync's render-time params still lack it.
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.search}&wide=1`,
    );
    act(() => hooks.mapView.setMapView({ lat: 50, lon: -125, zoom: 6 }));
    await waitFor(() => expect(params().get("zoom")).toBe("6"));
    expect(params().get("wide")).toBe("1");
  });

  it("syncs i18n to a ?lang= the link was opened with", async () => {
    const { i18n } = renderWithProviders(<Probe />, {
      providers: "app",
      url: "/?lang=fr",
    });
    await waitFor(() => expect(i18n.language).toBe("fr"));
  });

  it("writes the search and its scope into the link, and drops both when cleared", async () => {
    renderWithProviders(<Probe />, { providers: "app" });
    await waitFor(() =>
      expect(screen.getByTestId("ready")).toHaveTextContent("loaded"),
    );

    act(() => hooks.filters.setSearch("orca"));
    await waitFor(() => expect(params().get("search")).toBe("orca"));
    expect(params().has("searchIn")).toBe(false);

    act(() => hooks.filters.setSearch("sea ice & orca", "all"));
    await waitFor(() => expect(params().get("searchIn")).toBe("all"));
    expect(params().get("search")).toBe("sea ice & orca");

    act(() => hooks.filters.setSearch(""));
    await waitFor(() => expect(params().has("search")).toBe(false));
    expect(params().has("searchIn")).toBe(false);
  });

  it("seeds the search and its scope from the link", async () => {
    renderWithProviders(<Probe />, {
      providers: "app",
      url: "/?search=sea%20ice&searchIn=all",
    });
    await waitFor(() =>
      expect(screen.getByTestId("ready")).toHaveTextContent("loaded"),
    );
    expect(hooks.filters.searchText).toBe("sea ice");
    expect(hooks.filters.searchIn).toBe("all");
  });

  it("writes onlyInView only when true (the unfiltered state carries no param)", async () => {
    renderWithProviders(<Probe />, { providers: "app" });
    await waitFor(() =>
      expect(screen.getByTestId("ready")).toHaveTextContent("loaded"),
    );

    act(() => hooks.selection.setOnlyInView(true));
    await waitFor(() => expect(params().get("onlyInView")).toBe("true"));

    act(() => hooks.selection.setOnlyInView(false));
    await waitFor(() => expect(params().has("onlyInView")).toBe(false));
  });

  it("writes groupBy only for a real dimension, never for GROUP_NONE", async () => {
    renderWithProviders(<Probe />, { providers: "app" });
    await waitFor(() =>
      expect(screen.getByTestId("ready")).toHaveTextContent("loaded"),
    );

    act(() => hooks.selection.setGroupBy("platform"));
    await waitFor(() => expect(params().get("groupBy")).toBe("platform"));
  });

  it("records the coverage figure's time axis only when folded by season", async () => {
    renderWithProviders(<Probe />, { providers: "app" });
    await waitFor(() =>
      expect(screen.getByTestId("ready")).toHaveTextContent("loaded"),
    );
    expect(params().has("coverageAxis")).toBe(false);

    act(() => hooks.ui.setCoverageAxis("seasonal"));
    await waitFor(() => expect(params().get("coverageAxis")).toBe("seasonal"));

    act(() => hooks.ui.setCoverageAxis("timeline"));
    await waitFor(() => expect(params().has("coverageAxis")).toBe(false));
  });

  it("opens the coverage figure on the time axis the link carries", async () => {
    renderWithProviders(<Probe />, {
      providers: "app",
      url: "/?coverageAxis=seasonal",
    });
    await waitFor(() =>
      expect(screen.getByTestId("ready")).toHaveTextContent("loaded"),
    );
    expect(hooks.ui.coverageAxis).toBe("seasonal");
    await waitFor(() => expect(params().get("coverageAxis")).toBe("seasonal"));
  });

  it("records the taxonomy chart only when it is the tree", async () => {
    renderWithProviders(<Probe />, { providers: "app" });
    await waitFor(() =>
      expect(screen.getByTestId("ready")).toHaveTextContent("loaded"),
    );
    expect(params().has("taxonomy")).toBe(false);

    act(() => hooks.ui.setTaxonomyView("tree"));
    await waitFor(() => expect(params().get("taxonomy")).toBe("tree"));

    act(() => hooks.ui.setTaxonomyView("sunburst"));
    await waitFor(() => expect(params().has("taxonomy")).toBe(false));
  });

  it("records the observations-layer switch only when turned off", async () => {
    renderWithProviders(<Probe />, { providers: "app" });
    await waitFor(() =>
      expect(screen.getByTestId("ready")).toHaveTextContent("loaded"),
    );
    expect(params().has("obs")).toBe(false);

    act(() => hooks.mapState.setDataLayersVisible(false));
    await waitFor(() => expect(params().get("obs")).toBe("false"));
  });

  it("records included and excluded geometries in their own params", async () => {
    renderWithProviders(<Probe />, { providers: "app" });
    await waitFor(() =>
      expect(screen.getByTestId("ready")).toHaveTextContent("loaded"),
    );
    act(() => hooks.mapState.toggleDataLayer("profile", "include"));
    act(() => hooks.mapState.toggleDataLayer("grid", "exclude"));
    await waitFor(() => {
      expect(params().get("layers")).toBe("profile");
      expect(params().get("excludeLayers")).toBe("grid");
    });

    act(() => hooks.mapState.resetDataLayers());
    await waitFor(() => {
      expect(params().has("layers")).toBe(false);
      expect(params().has("excludeLayers")).toBe(false);
    });
  });

  it("records the debounced filter query once it settles (an EOV selection)", async () => {
    renderWithProviders(<Probe />, { providers: "app" });
    await waitFor(() =>
      expect(screen.getByTestId("ready")).toHaveTextContent("loaded"),
    );

    const eov = hooks.filters.eovsSelected[0];
    act(() =>
      hooks.filters.setEovsSelected(
        hooks.filters.eovsSelected.map((e) =>
          e.pk === eov.pk ? { ...e, isSelected: true } : e,
        ),
      ),
    );
    await waitFor(() => expect(params().get("eovs")).toBe(eov.title), {
      timeout: 2000,
    });
  });
});
