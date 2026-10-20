import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import ClearMapSelection from "./ClearMapSelection.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";

let latestMap;
let latestSelection;
function Probe() {
  latestMap = useMapState();
  latestSelection = useSelection();
  return null;
}

describe("ClearMapSelection", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("shows only while a map click is highlighted, and clears it", async () => {
    renderWithProviders(
      <>
        <ClearMapSelection />
        <Probe />
      </>,
      { providers: "app" },
    );
    expect(screen.queryByTestId("clear-map-selection")).not.toBeInTheDocument();

    act(() => latestMap.setFeatureQuery({ nonce: 1, lngLat: [0, 0] }));
    await userEvent.click(screen.getByTestId("clear-map-selection"));

    expect(latestMap.featureQuery).toBeNull();
    expect(screen.queryByTestId("clear-map-selection")).not.toBeInTheDocument();
  });

  it("clears the dataset selection while one dataset is open", async () => {
    renderWithProviders(
      <>
        <ClearMapSelection />
        <Probe />
      </>,
      { providers: "app" },
    );
    await waitFor(() =>
      expect(latestSelection.initialPointsQueryComplete).toBe(true),
    );
    act(() => {
      latestSelection.setInspectDataset(latestSelection.pointsData[0]);
      latestMap.setFeatureQuery({ nonce: 1, lngLat: [0, 0] });
    });

    const button = await screen.findByRole("button", {
      name: "Clear dataset selection",
    });
    await userEvent.click(button);

    await waitFor(() => expect(latestSelection.inspectDataset).toBeFalsy());
    expect(latestMap.featureQuery).toBeNull();
    expect(screen.queryByTestId("clear-map-selection")).not.toBeInTheDocument();
  });
});
