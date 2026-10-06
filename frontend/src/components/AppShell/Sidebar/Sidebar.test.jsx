import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import pointQueryFixture from "../../../../e2e/fixtures/api/pointQuery.json";
import Sidebar from "./Sidebar.jsx";

let latestSelection;
function Probe() {
  latestSelection = useSelection();
  return (
    <span data-testid="state">
      {latestSelection.initialPointsQueryComplete ? "ready" : "loading"}
    </span>
  );
}

const seenTips = () =>
  JSON.parse(window.localStorage.getItem("cde.seenTips") || "[]");

describe("Sidebar tips", () => {
  beforeEach(() => {
    installMockFetch();
    window.localStorage.setItem("cde.introSeen", "true");
  });

  it("offers how filters shape a download once a dataset is added", async () => {
    renderWithProviders(
      <>
        <Sidebar />
        <Probe />
      </>,
      { providers: "app" },
    );
    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("ready"),
    );
    expect(seenTips()).toEqual([]);
    act(() =>
      latestSelection.addDatasetsToSelection([pointQueryFixture[0].pk]),
    );
    await waitFor(() => expect(seenTips()).toEqual(["filtersCutDownload"]));
  });

  it("offers direct links next, once the filters tip has been read", async () => {
    window.localStorage.setItem(
      "cde.seenTips",
      JSON.stringify(["filtersCutDownload"]),
    );
    renderWithProviders(
      <>
        <Sidebar />
        <Probe />
      </>,
      { providers: "app" },
    );
    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("ready"),
    );
    act(() =>
      latestSelection.addDatasetsToSelection([pointQueryFixture[0].pk]),
    );
    await waitFor(() =>
      expect(seenTips()).toEqual(["filtersCutDownload", "directLinks"]),
    );
  });
});
