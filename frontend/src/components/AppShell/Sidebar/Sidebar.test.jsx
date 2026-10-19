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
    await screen.findByTestId("sidebar-wide-toggle");
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

  it("leaves Escape to a dialog open over it", async () => {
    const { user } = await renderDatasetPage("&wide=1");
    document.body.classList.add("cioos-modal-open");
    try {
      await user.keyboard("{Escape}");
      expect(screen.getByTestId("sidebar")).toHaveClass("wide");
    } finally {
      document.body.classList.remove("cioos-modal-open");
    }
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
