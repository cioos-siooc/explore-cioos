import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor, act } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import { MOBILE_WIDTH, setViewportWidth } from "../../../test/viewport.js";
import FeatureCard from "./FeatureCard.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import pointQueryFixture from "../../../../e2e/fixtures/api/pointQuery.json";

let latestMap;
let latestSelection;
function Probe() {
  latestMap = useMapState();
  latestSelection = useSelection();
  const { initialPointsQueryComplete } = latestSelection;
  return (
    <span data-testid="state">
      {initialPointsQueryComplete ? "ready" : "loading"}
    </span>
  );
}

async function renderReady() {
  // FeatureCard defers to the datasets sidebar once it's open (see the
  // component's own comment) — the sidebar starts open at desktop width, so
  // force the phone-width "starts closed" case to actually exercise the card.
  setViewportWidth(MOBILE_WIDTH);
  const result = renderWithProviders(
    <>
      <FeatureCard />
      <Probe />
    </>,
    { providers: "app" },
  );
  await waitFor(() =>
    expect(screen.getByTestId("state")).toHaveTextContent("ready"),
  );
  return result;
}

describe("FeatureCard", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("renders nothing without a featureQuery", async () => {
    await renderReady();
    expect(screen.queryByTestId("feature-card")).not.toBeInTheDocument();
  });

  it("shows the empty state when nothing under the click resolves against pointsData", async () => {
    await renderReady();
    act(() => {
      latestMap.setFeatureQuery({
        nonce: 1,
        lngLat: [0, 0],
        items: [{ kind: "observation", pk: 999999, count: 3 }],
      });
    });
    expect(
      screen.getByText(
        "Nothing here is in the current results — the filters have excluded it.",
      ),
    ).toBeInTheDocument();
  });

  it("resolves an observation row against pointsData and shows its title", async () => {
    await renderReady();
    const row = pointQueryFixture[0];
    act(() => {
      latestMap.setFeatureQuery({
        nonce: 2,
        lngLat: [0, 0],
        items: [
          { kind: "observation", pk: row.pk, count: 4, title: row.title },
        ],
      });
    });
    expect(screen.getByTitle(row.title)).toBeInTheDocument();
  });

  it("closing (X) clears the featureQuery", async () => {
    const { user } = await renderReady();
    const row = pointQueryFixture[0];
    act(() => {
      latestMap.setFeatureQuery({
        nonce: 3,
        lngLat: [0, 0],
        items: [
          { kind: "observation", pk: row.pk, count: 1, title: row.title },
        ],
      });
    });
    await user.click(screen.getByTitle("Close"));
    expect(latestMap.featureQuery).toBeNull();
  });

  it("Escape closes the card", async () => {
    const { user } = await renderReady();
    const row = pointQueryFixture[0];
    act(() => {
      latestMap.setFeatureQuery({
        nonce: 4,
        lngLat: [0, 0],
        items: [
          { kind: "observation", pk: row.pk, count: 1, title: row.title },
        ],
      });
    });
    await user.keyboard("{Escape}");
    expect(latestMap.featureQuery).toBeNull();
  });

  it("Add one adds the dataset to the selection without closing the card", async () => {
    const { user } = await renderReady();
    const row =
      pointQueryFixture.find((r) => !r.selected) || pointQueryFixture[0];
    act(() => {
      latestMap.setFeatureQuery({
        nonce: 5,
        lngLat: [0, 0],
        items: [
          { kind: "observation", pk: row.pk, count: 1, title: row.title },
        ],
      });
    });
    await user.click(screen.getByTitle("Add this dataset to the selection"));
    await waitFor(() => expect(latestMap.featureQuery).not.toBeNull());
  });

  it("opening a track row selects the trajectory and closes the card", async () => {
    const { user } = await renderReady();
    act(() => {
      latestMap.setFeatureQuery({
        nonce: 6,
        lngLat: [0, 0],
        items: [
          {
            kind: "track",
            pk: 424242,
            trajectoryId: "traj-a",
            title: "Glider track",
          },
        ],
      });
    });
    await user.click(screen.getByTitle("Glider track"));
    await waitFor(() =>
      expect(latestSelection.selectedTrajectory).toMatchObject({
        datasetPk: 424242,
        trajectoryId: "traj-a",
      }),
    );
    expect(latestMap.featureQuery).toBeNull();
  });

  it("Add all adds every selectable row and closes the card", async () => {
    const { user } = await renderReady();
    const [rowA, rowB] = pointQueryFixture.filter((r) => !r.selected);
    act(() => {
      latestMap.setFeatureQuery({
        nonce: 7,
        lngLat: [0, 0],
        items: [
          { kind: "observation", pk: rowA.pk, count: 2, title: rowA.title },
          { kind: "observation", pk: rowB.pk, count: 1, title: rowB.title },
        ],
      });
    });
    await user.click(screen.getByTitle("Select all 2 datasets here"));
    await waitFor(() => {
      const updated = latestSelection.pointsData.find((p) => p.pk === rowA.pk);
      expect(updated.selected).toBe(true);
    });
    expect(latestMap.featureQuery).toBeNull();
  });

  it("Zoom here frames the click's bounds and closes the card", async () => {
    const { user } = await renderReady();
    const row = pointQueryFixture[0];
    act(() => {
      latestMap.setFeatureQuery({
        nonce: 8,
        lngLat: [0, 0],
        bounds: [
          [-10, -10],
          [10, 10],
        ],
        items: [
          { kind: "observation", pk: row.pk, count: 1, title: row.title },
        ],
      });
    });
    await user.click(screen.getByText("Zoom here"));
    await waitFor(() =>
      expect(latestMap.zoomTarget?.geometry?.type).toBe("Polygon"),
    );
    expect(latestMap.featureQuery).toBeNull();
  });

  it("shows a Show more button past the visible-row cap, and expands the list", async () => {
    const { user } = await renderReady();
    const rows = pointQueryFixture.slice(0, 7);
    act(() => {
      latestMap.setFeatureQuery({
        nonce: 9,
        lngLat: [0, 0],
        items: rows.map((row) => ({
          kind: "observation",
          pk: row.pk,
          count: 1,
          title: row.title,
        })),
      });
    });
    const moreButton = await screen.findByText("Show 2 more");
    expect(document.querySelectorAll(".featureCardRowOpen")).toHaveLength(5);
    await user.click(moreButton);
    await waitFor(() =>
      expect(document.querySelectorAll(".featureCardRowOpen")).toHaveLength(7),
    );
  });

  it("a track row and grid row sort before observations, and a grid row shows the grid icon", async () => {
    const row = pointQueryFixture[0];
    await renderReady();
    act(() => {
      latestMap.setFeatureQuery({
        nonce: 10,
        lngLat: [0, 0],
        items: [
          { kind: "observation", pk: row.pk, count: 1, title: row.title },
          {
            kind: "track",
            pk: 111,
            trajectoryId: "t1",
            title: "A track",
          },
          {
            kind: "grid",
            pk: 222,
            title: "A gridded dataset",
          },
        ],
      });
    });
    const rowsShown = document.querySelectorAll(".featureCardRow");
    // KIND_ORDER is track, observation, grid.
    expect(rowsShown[0]).toHaveTextContent("A track");
    expect(rowsShown[1]).toHaveTextContent(row.title);
    expect(rowsShown[2]).toHaveTextContent("A gridded dataset");
    // A grid row's "+" is disabled — griddap is metadata-only, never
    // selectable — and titled accordingly.
    expect(
      screen.getByTitle("Gridded datasets are accessed directly on ERDDAP"),
    ).toBeInTheDocument();
  });
});
