import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import TrajectoryDate from "./TrajectoryDate.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { useTips } from "../../../state/tips/TipsProvider.jsx";

let latest;
function Probe() {
  latest = useMapState();
  const { initialPointsQueryComplete } = useSelection();
  const { startTour } = useTips();
  return (
    <>
      <span data-testid="state">
        {initialPointsQueryComplete ? "ready" : "loading"}
      </span>
      <button type="button" onClick={() => startTour("trajectory")}>
        trajectory tip
      </button>
    </>
  );
}

async function renderReady(url) {
  const result = renderWithProviders(
    <>
      <TrajectoryDate />
      <Probe />
    </>,
    { providers: "app", url },
  );
  await waitFor(() =>
    expect(screen.getByTestId("state")).toHaveTextContent("ready"),
  );
  return result;
}

const toggle = () =>
  screen.getByRole("button", { name: "Track date and window" });

async function renderOpened() {
  const result = await renderReady();
  await result.user.click(toggle());
  return result;
}

describe("TrajectoryDate", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("folds the controls away at their defaults, behind a disclosure", async () => {
    const { user } = await renderReady();
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Track window")).toBeNull();
    expect(screen.queryByRole("slider")).toBeNull();
    await user.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Track window")).toBeInTheDocument();
    await user.click(toggle());
    expect(screen.queryByLabelText("Track window")).toBeNull();
  });

  it("starts open on a date set by the link, so it is never hidden", async () => {
    await renderReady("/?scrubTime=2020-06-01");
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByDisplayValue("2020-06-01")).toBeInTheDocument();
  });

  it("starts open on a track window set by the link", async () => {
    await renderReady("/?trail=30");
    expect(screen.getByLabelText("Track window")).toHaveValue("30");
  });

  it("opens for the trajectory tip, which points at the date", async () => {
    const { user } = await renderReady();
    await user.click(screen.getByText("trajectory tip"));
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByTitle("Position and direction at selected date"),
    ).toHaveAttribute("data-tip-highlight");
  });

  it("renders the track line and heading rows, and a rail with the scrub handle", async () => {
    await renderOpened();
    expect(screen.getByLabelText("Track window")).toHaveValue("90");
    expect(screen.getAllByRole("slider")).toHaveLength(1);
  });

  it("stepping the date forward/back with the chevrons commits scrubTime", async () => {
    const { user } = await renderOpened();
    const before = latest.scrubTime;
    await user.click(screen.getByTitle("Previous day"));
    await waitFor(() => expect(latest.scrubTime).not.toBe(before));
  });

  it("the next-day button is disabled at today, the axis maximum", async () => {
    await renderOpened();
    // scrubTime defaults to today (todayIso()), so stepping forward is
    // already at the axis's upper bound.
    expect(screen.getByTitle("Next day")).toBeDisabled();
  });

  it("changing the trail window updates trailingDays", async () => {
    const { user } = await renderOpened();
    await user.selectOptions(screen.getByLabelText("Track window"), "30");
    await waitFor(() => expect(latest.trailingDays).toBe(30));
  });
});
