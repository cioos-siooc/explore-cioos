import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../test/mockFetch.js";
import { useFilters } from "./FilterProvider.jsx";

let latest;

function Probe() {
  latest = useFilters();
  return (
    <span data-testid="state">
      {latest.catalogLoaded ? "loaded" : "loading"}
    </span>
  );
}

async function renderLoaded(options) {
  renderWithProviders(<Probe />, { providers: "app", ...options });
  await waitFor(() =>
    expect(screen.getByTestId("state")).toHaveTextContent("loaded"),
  );
}

describe("FilterProvider", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("loads the catalog from the fixtures and exposes it through useFilters", async () => {
    await renderLoaded();
    expect(latest.totalNumberOfDatasets).toBeGreaterThan(0);
    expect(latest.eovsSelected.length).toBeGreaterThan(0);
    expect(latest.platformsSelected.map((p) => p.title)).toContain("mooring");
    expect(latest.obisNodesSelected.map((n) => n.title)).toContain(
      "Canada OBIS",
    );
    expect(latest.catalogError).toBe(false);
  });

  it("filters the obis.org sentinel out of erddapServersSelected", async () => {
    await renderLoaded();
    expect(
      latest.erddapServersSelected.some((s) => s.url === "https://obis.org"),
    ).toBe(false);
  });

  it("seeds selections from the URL the app was opened at (share-link hydration)", async () => {
    await renderLoaded({ url: "/?eovs=oxygen&platforms=mooring" });
    const oxygen = latest.eovsSelected.find((e) => e.title === "oxygen");
    expect(oxygen.isSelected).toBe(true);
    const mooring = latest.platformsSelected.find((p) => p.title === "mooring");
    expect(mooring.isSelected).toBe(true);
    const otherPlatform = latest.platformsSelected.find(
      (p) => p.title !== "mooring",
    );
    expect(otherPlatform.isSelected).toBe(false);
  });

  it("seeds time and depth range from the URL", async () => {
    await renderLoaded({
      url: "/?timeMin=2010-01-01&timeMax=2020-01-01&depthMin=10&depthMax=500",
    });
    expect(latest.startDate).toBe("2010-01-01");
    expect(latest.endDate).toBe("2020-01-01");
    expect(latest.startDepth).toBe(10);
    expect(latest.endDepth).toBe(500);
    expect(latest.timeFilterActive).toBe(true);
    expect(latest.depthFilterActive).toBe(true);
  });

  it("treats a legacy includeObis=false with no server list as every server selected", async () => {
    await renderLoaded({ url: "/?includeObis=false" });
    expect(latest.erddapServersSelected.every((s) => s.isSelected)).toBe(true);
  });

  it("resetFilters clears every selection and restores the default date/depth range", async () => {
    await renderLoaded({ url: "/?eovs=oxygen" });
    act(() => {
      latest.setStartDate("2015-01-01");
      latest.resetFilters();
    });
    await waitFor(() => {
      expect(latest.eovsSelected.every((e) => !e.isSelected)).toBe(true);
      expect(latest.startDate).toBe("1900-01-01");
    });
  });

  it("buildActiveFilters reflects a selected eov as a removable chip, and removing it clears just that one", async () => {
    await renderLoaded({ url: "/?eovs=oxygen" });
    let chips = latest.buildActiveFilters({
      timeframesBadgeTitle: "",
      depthRangeBadgeTitle: "",
    });
    let eovChip = chips.find((c) => c.key === "eovs");
    expect(eovChip.items).toHaveLength(1);

    act(() => eovChip.items[0].remove());
    await waitFor(() => {
      chips = latest.buildActiveFilters({
        timeframesBadgeTitle: "",
        depthRangeBadgeTitle: "",
      });
      eovChip = chips.find((c) => c.key === "eovs");
      expect(eovChip).toBeUndefined();
    });
  });

  it("showObis is false only when a source filter is active with no OBIS node selected", async () => {
    await renderLoaded();
    expect(latest.showObis).toBe(true); // nothing selected -> unfiltered -> OBIS shown

    act(() => {
      latest.setErddapServersSelected(
        latest.erddapServersSelected.map((s) => ({ ...s, isSelected: true })),
      );
    });
    await waitFor(() => expect(latest.showObis).toBe(false));

    act(() => {
      latest.setObisNodesSelected(
        latest.obisNodesSelected.map((n, i) =>
          i === 0 ? { ...n, isSelected: true } : n,
        ),
      );
    });
    await waitFor(() => expect(latest.showObis).toBe(true));
  });

  it("drops scientificNamesSelected from query while OBIS is hidden by the source filter", async () => {
    await renderLoaded({ url: "/?scientificNames=Orcinus%20orca" });
    expect(latest.scientificNamesSelected).toEqual(["Orcinus orca"]);
    await waitFor(() =>
      expect(latest.query.scientificNamesSelected).toEqual(["Orcinus orca"]),
    );

    act(() => {
      latest.setErddapServersSelected(
        latest.erddapServersSelected.map((s) => ({ ...s, isSelected: true })),
      );
    });
    await waitFor(() => expect(latest.showObis).toBe(false));
    await waitFor(() =>
      expect(latest.query.scientificNamesSelected).toEqual([]),
    );
    // The selection itself survives — only the outgoing query drops it, so a
    // later source change can bring it back without the user re-typing it.
    expect(latest.scientificNamesSelected).toEqual(["Orcinus orca"]);
  });

  it("re-derives erddapServersSelected titles when the language changes, without an extra fetch", async () => {
    const fetchCallsBefore = () => global.fetch.mock.calls.length;
    const { i18n } = renderWithProviders(<Probe />, { providers: "app" });
    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("loaded"),
    );
    const pacific = latest.erddapServersSelected.find(
      (s) => s.url === "https://data.cioospacific.ca/erddap",
    );
    expect(pacific.title).toBe("CIOOS Pacific");
    const callsBefore = fetchCallsBefore();

    await act(async () => i18n.changeLanguage("fr"));
    await waitFor(() => {
      const frenchPacific = latest.erddapServersSelected.find(
        (s) => s.url === "https://data.cioospacific.ca/erddap",
      );
      expect(frenchPacific.title).toBe("SIOOC Pacifique");
    });
    // Re-labeling is a pure client-side derivation (erddapServers.json) — it
    // must not re-hit the catalog endpoints.
    expect(fetchCallsBefore()).toBe(callsBefore);
  });
});
