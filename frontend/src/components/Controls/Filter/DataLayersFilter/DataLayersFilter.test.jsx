import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../../test/mockFetch.js";
import DataLayersFilter from "./DataLayersFilter.jsx";
import { useMapState } from "../../../../state/map/MapStateProvider.jsx";

async function renderReady(ui) {
  const result = renderWithProviders(ui, { providers: "app" });
  await waitFor(() => expect(screen.getByText("Profile")).toBeInTheDocument());
  return result;
}

describe("DataLayersFilter", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("shows all seven layers unticked by default (unfiltered)", async () => {
    await renderReady(<DataLayersFilter />);
    expect(screen.getByText("Gridded data")).toBeInTheDocument();
    expect(
      document.querySelectorAll(".dataLayersFilter .optionButton.selected"),
    ).toHaveLength(0);
  });

  it("clicking a layer narrows the selection to just that one", async () => {
    let latest;
    function Probe() {
      latest = useMapState();
      return null;
    }
    const { user } = await renderReady(
      <>
        <DataLayersFilter />
        <Probe />
      </>,
    );
    await user.click(screen.getByText("Gridded data"));
    await waitFor(() => expect(latest.dataLayers.grid).toBe(true));
    expect(latest.dataLayers.profile).toBe(false);
  });
});
