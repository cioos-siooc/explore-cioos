import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import GriddapDetails from "./GriddapDetails.jsx";

const GRID_DATASET_NO_WMS = {
  pk: 1,
  grid_dimensions: [
    { name: "longitude", n_values: 100, min: -180, max: 180 },
    { name: "latitude", n_values: 50, min: -90, max: 90 },
  ],
  grid_variables: [{ name: "temp", long_name: "Temperature", units: "C" }],
};

const GRID_DATASET_WMS = {
  ...GRID_DATASET_NO_WMS,
  wms_url: "https://erddap.example/wms",
  erddap_url: "https://erddap.example/tabledap/foo.html",
};

describe("GriddapDetails", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("shows the no-WMS message when the dataset has no wms_url", () => {
    renderWithProviders(
      <GriddapDetails
        dataset={GRID_DATASET_NO_WMS}
        activeWmsOverlay={undefined}
        setActiveWmsOverlay={() => {}}
      />,
      { providers: "app" },
    );
    expect(
      screen.getByText("Map preview is not available for this dataset — access it on ERDDAP"),
    ).toBeInTheDocument();
  });

  it("lists dimensions and variables", () => {
    renderWithProviders(
      <GriddapDetails
        dataset={GRID_DATASET_NO_WMS}
        activeWmsOverlay={undefined}
        setActiveWmsOverlay={() => {}}
      />,
      { providers: "app" },
    );
    expect(screen.getByText("longitude")).toBeInTheDocument();
    expect(screen.getByText("latitude")).toBeInTheDocument();
    expect(screen.getByText("Temperature")).toBeInTheDocument();
    expect(screen.getByText("temp")).toBeInTheDocument();
  });

  it("auto-shows the WMS overlay when the dataset has a wms_url and variables", async () => {
    const setActiveWmsOverlay = vi.fn();
    renderWithProviders(
      <GriddapDetails
        dataset={GRID_DATASET_WMS}
        activeWmsOverlay={undefined}
        setActiveWmsOverlay={setActiveWmsOverlay}
      />,
      { providers: "app" },
    );
    await waitFor(() => expect(setActiveWmsOverlay).toHaveBeenCalled());
    const overlay = setActiveWmsOverlay.mock.calls[0][0];
    expect(overlay.pk).toBe(GRID_DATASET_WMS.pk);
  });

  it("the show-on-map switch is disabled without variables", () => {
    renderWithProviders(
      <GriddapDetails
        dataset={{ ...GRID_DATASET_WMS, grid_variables: [] }}
        activeWmsOverlay={undefined}
        setActiveWmsOverlay={() => {}}
      />,
      { providers: "app" },
    );
    expect(screen.getByLabelText("Show on map")).toBeDisabled();
  });

  it("toggling the switch off clears the overlay", async () => {
    const setActiveWmsOverlay = vi.fn();
    const overlay = {
      pk: GRID_DATASET_WMS.pk,
      erddapUrl: GRID_DATASET_WMS.erddap_url,
      variables: GRID_DATASET_WMS.grid_variables,
      variable: GRID_DATASET_WMS.grid_variables[0],
      dimensions: GRID_DATASET_WMS.grid_dimensions,
    };
    const { user } = renderWithProviders(
      <GriddapDetails
        dataset={GRID_DATASET_WMS}
        activeWmsOverlay={overlay}
        setActiveWmsOverlay={setActiveWmsOverlay}
      />,
      { providers: "app" },
    );
    await user.click(screen.getByLabelText("Show on map"));
    expect(setActiveWmsOverlay).toHaveBeenCalledWith();
  });
});
