import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../test/renderWithProviders.jsx";
import { installMockFetch } from "../test/mockFetch.js";
import { useFilters } from "./filters/FilterProvider.jsx";
import { useSelection } from "./selection/SelectionProvider.jsx";
import { useMapState } from "./map/MapStateProvider.jsx";

// UrlSync (src/state/useUrlSync.js) is already mounted inside AppProviders —
// it is the sole writer of window.location. There is nothing to render it
// standalone against; instead these drive real state through the same
// providers it reads, under the full app tree, and read the URL back.
let hooks;

function Probe() {
  hooks = {
    filters: useFilters(),
    selection: useSelection(),
    mapState: useMapState(),
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

  it("syncs i18n to a ?lang= the link was opened with", async () => {
    const { i18n } = renderWithProviders(<Probe />, {
      providers: "app",
      url: "/?lang=fr",
    });
    await waitFor(() => expect(i18n.language).toBe("fr"));
  });

  it("writes the title search into ?search=, and drops it when cleared", async () => {
    renderWithProviders(<Probe />, { providers: "app" });
    await waitFor(() =>
      expect(screen.getByTestId("ready")).toHaveTextContent("loaded"),
    );

    act(() => hooks.selection.setDatasetTitleSearchText("orca"));
    await waitFor(() => expect(params().get("search")).toBe("orca"));

    act(() => hooks.selection.setDatasetTitleSearchText(""));
    await waitFor(() => expect(params().has("search")).toBe(false));
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

  it("records the observations-layer switch only when turned off", async () => {
    renderWithProviders(<Probe />, { providers: "app" });
    await waitFor(() =>
      expect(screen.getByTestId("ready")).toHaveTextContent("loaded"),
    );
    expect(params().has("obs")).toBe(false);

    act(() => hooks.mapState.setDataLayersVisible(false));
    await waitFor(() => expect(params().get("obs")).toBe("false"));
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
