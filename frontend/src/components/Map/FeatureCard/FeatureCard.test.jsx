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
});
