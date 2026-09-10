import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import TrajectoryDate from "./TrajectoryDate.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";

let latest;
function Probe() {
  latest = useMapState();
  const { initialPointsQueryComplete } = useSelection();
  return (
    <span data-testid="state">
      {initialPointsQueryComplete ? "ready" : "loading"}
    </span>
  );
}

async function renderReady() {
  const result = renderWithProviders(
    <>
      <TrajectoryDate />
      <Probe />
    </>,
    { providers: "app" },
  );
  await waitFor(() =>
    expect(screen.getByTestId("state")).toHaveTextContent("ready"),
  );
  return result;
}

describe("TrajectoryDate", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("renders the track line and heading rows, and a rail with the scrub handle", async () => {
    await renderReady();
    expect(screen.getByText("Track")).toBeInTheDocument();
    expect(screen.getAllByRole("slider")).toHaveLength(1);
  });

  it("stepping the date forward/back with the chevrons commits scrubTime", async () => {
    const { user } = await renderReady();
    const before = latest.scrubTime;
    await user.click(screen.getByTitle("Previous day"));
    await waitFor(() => expect(latest.scrubTime).not.toBe(before));
  });

  it("the next-day button is disabled at today, the axis maximum", async () => {
    await renderReady();
    // scrubTime defaults to today (todayIso()), so stepping forward is
    // already at the axis's upper bound.
    expect(screen.getByTitle("Next day")).toBeDisabled();
  });

  it("changing the trail window updates trailingDays", async () => {
    const { user } = await renderReady();
    await user.selectOptions(screen.getByLabelText("Trail"), "30");
    await waitFor(() => expect(latest.trailingDays).toBe(30));
  });
});
