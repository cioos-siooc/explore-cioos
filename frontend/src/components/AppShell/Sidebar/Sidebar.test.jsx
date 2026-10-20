import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import { MOBILE_WIDTH, setViewportWidth } from "../../../test/viewport.js";
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

describe("Sidebar wide view", () => {
  beforeEach(() => {
    installMockFetch();
    window.localStorage.setItem("cde.introSeen", "true");
  });

  async function renderDatasetPage(query = "") {
    const result = renderWithProviders(
      <>
        <Sidebar />
        <Probe />
      </>,
      {
        providers: "app",
        url: `/?dataset=${pointQueryFixture[0].dataset_id}${query}`,
      },
    );
    await screen.findByTestId("sidebar-back");
    return result;
  }

  it("widens the dataset page over the map and back, through the address", async () => {
    const { user } = await renderDatasetPage();
    expect(screen.getByTestId("sidebar")).not.toHaveClass("wide");

    await user.click(screen.getByTestId("sidebar-wide-toggle"));
    await waitFor(() => expect(window.location.search).toContain("wide=1"));
    expect(screen.getByTestId("sidebar")).toHaveClass("wide");

    await user.click(screen.getByTestId("sidebar-wide-toggle"));
    await waitFor(() => expect(window.location.search).not.toContain("wide="));
    expect(screen.getByTestId("sidebar")).not.toHaveClass("wide");
  });

  it("narrows on Escape and on a click outside it", async () => {
    const { user } = await renderDatasetPage("&wide=1");
    expect(screen.getByTestId("sidebar")).toHaveClass("wide");

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.getByTestId("sidebar")).not.toHaveClass("wide"),
    );

    await user.click(screen.getByTestId("sidebar-wide-toggle"));
    await user.click(await screen.findByTestId("sidebar-scrim"));
    await waitFor(() =>
      expect(screen.getByTestId("sidebar")).not.toHaveClass("wide"),
    );
  });

  it("leaves Escape to whatever nearer answers it first", async () => {
    const { user } = await renderDatasetPage("&wide=1");
    // A dialog stops it; a pinned citation claims it.
    for (const answer of ["stopPropagation", "preventDefault"]) {
      const handler = (event) => event.key === "Escape" && event[answer]();
      document.addEventListener("keydown", handler);
      try {
        await user.keyboard("{Escape}");
        expect(screen.getByTestId("sidebar")).toHaveClass("wide");
      } finally {
        document.removeEventListener("keydown", handler);
      }
    }
  });

  it("widens the datasets list too, and a dataset opened from it stays wide", async () => {
    const { user } = renderWithProviders(
      <>
        <Sidebar />
        <Probe />
      </>,
      { providers: "app" },
    );
    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("ready"),
    );
    await user.click(screen.getByTestId("sidebar-wide-toggle"));
    await waitFor(() => expect(window.location.search).toContain("wide=1"));
    expect(screen.getByTestId("sidebar")).toHaveClass("wide");

    act(() => latestSelection.setInspectDataset(pointQueryFixture[0]));
    await screen.findByTestId("sidebar-back");
    expect(screen.getByTestId("sidebar")).toHaveClass("wide");
  });

  it("reopens at the size it was hidden at, like a minimized window", async () => {
    const { user } = await renderDatasetPage("&wide=1");
    await user.click(screen.getByTestId("sidebar-collapse"));
    await waitFor(() =>
      expect(screen.getByTestId("sidebar")).not.toHaveClass("wide"),
    );
    expect(screen.queryByTestId("sidebar-scrim")).not.toBeInTheDocument();
    expect(window.location.search).toContain("wide=1");
  });

  it("is not offered on a phone, where the page is already full-screen", async () => {
    setViewportWidth(MOBILE_WIDTH);
    renderWithProviders(
      <>
        <Sidebar />
        <Probe />
      </>,
      {
        providers: "app",
        url: `/?dataset=${pointQueryFixture[0].dataset_id}&wide=1`,
      },
    );
    await screen.findByTestId("sidebar-back");
    expect(screen.queryByTestId("sidebar-wide-toggle")).not.toBeInTheDocument();
    expect(screen.getByTestId("sidebar")).not.toHaveClass("wide");
  });
});
