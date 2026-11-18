import { describe, it, expect, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import * as React from "react";

import { renderWithProviders } from "../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../test/mockFetch.js";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  TABLET_WIDTH,
  setViewportWidth,
} from "../../test/viewport.js";
import { useSelection } from "../selection/SelectionProvider.jsx";
import { useUI } from "./UIProvider.jsx";

// Asserts through the same interface the chrome uses.
function SidebarProbe() {
  const { sidebarOpen, setSidebarOpen } = useUI();
  return (
    <div>
      <span data-testid="state">{sidebarOpen ? "open" : "closed"}</span>
      <button type="button" onClick={() => setSidebarOpen(!sidebarOpen)}>
        toggle
      </button>
    </div>
  );
}

const state = () => screen.getByTestId("state").textContent;

describe("the datasets sidebar default", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it.each([
    ["wide screen", DESKTOP_WIDTH],
    ["tablet", TABLET_WIDTH],
    ["phone", MOBILE_WIDTH],
  ])("starts closed on a %s", async (_, width) => {
    setViewportWidth(width);
    renderWithProviders(<SidebarProbe />, { providers: "app" });
    await waitFor(() => expect(state()).toBe("closed"));
  });

  it("stays closed when the window is resized into a wide screen", async () => {
    setViewportWidth(TABLET_WIDTH);
    renderWithProviders(<SidebarProbe />, { providers: "app" });
    await waitFor(() => expect(state()).toBe("closed"));

    act(() => setViewportWidth(DESKTOP_WIDTH));
    expect(state()).toBe("closed");
  });
});

describe("revealing the sidebar for a drawn shape", () => {
  beforeEach(() => {
    installMockFetch();
  });

  const RING = [
    [-64, 44],
    [-63, 44],
    [-63, 45],
    [-64, 45],
    [-64, 44],
  ];

  function DrawProbe() {
    const { setPolygon } = useSelection();
    return (
      <>
        <SidebarProbe />
        <button type="button" onClick={() => setPolygon(RING)}>
          draw
        </button>
      </>
    );
  }

  it("opens a closed list on a wide screen", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    const { user } = renderWithProviders(<DrawProbe />, { providers: "app" });
    await waitFor(() => expect(state()).toBe("closed"));

    await user.click(screen.getByRole("button", { name: "draw" }));
    expect(state()).toBe("open");
  });

  it.each([
    ["tablet", TABLET_WIDTH],
    ["phone", MOBILE_WIDTH],
  ])("leaves the list closed on a %s", async (_, width) => {
    // The list would cover the shape just drawn.
    setViewportWidth(width);
    const { user } = renderWithProviders(<DrawProbe />, { providers: "app" });
    await waitFor(() => expect(state()).toBe("closed"));

    await user.click(screen.getByRole("button", { name: "draw" }));
    expect(state()).toBe("closed");
  });
});

describe("revealing the sidebar for a dataset page", () => {
  beforeEach(() => {
    installMockFetch();
  });

  function PageProbe() {
    const { pointsData, setInspectDataset } = useSelection();
    return (
      <>
        <SidebarProbe />
        <button type="button" onClick={() => setInspectDataset(pointsData[0])}>
          open
        </button>
      </>
    );
  }

  it("opens for a page, and stays closed over it when the results refresh", async () => {
    setViewportWidth(DESKTOP_WIDTH);
    const { user, i18n } = renderWithProviders(<PageProbe />, {
      providers: "app",
    });
    await waitFor(() => expect(state()).toBe("closed"));

    await user.click(screen.getByRole("button", { name: "open" }));
    await waitFor(() => expect(state()).toBe("open"));

    // Re-translating the results hands the same dataset back as a new object.
    await user.click(screen.getByRole("button", { name: "toggle" }));
    await act(async () => i18n.changeLanguage("fr"));
    expect(state()).toBe("closed");
  });
});

describe("the intro modal", () => {
  beforeEach(() => {
    installMockFetch();
  });

  function IntroProbe() {
    const { showIntroModal } = useUI();
    return (
      <span data-testid="state">{showIntroModal ? "shown" : "hidden"}</span>
    );
  }

  it("opens on a first visit", async () => {
    renderWithProviders(<IntroProbe />, { providers: "app" });
    await waitFor(() => expect(state()).toBe("shown"));
  });

  it("stays away once it has been closed", async () => {
    window.localStorage.setItem("cde.introSeen", "true");
    renderWithProviders(<IntroProbe />, { providers: "app" });
    await waitFor(() => expect(state()).toBe("hidden"));
  });

  it("is only marked seen when closed, not merely shown", async () => {
    let ui;
    function CloseProbe() {
      ui = useUI();
      return <IntroProbe />;
    }
    renderWithProviders(<CloseProbe />, { providers: "app" });
    await waitFor(() => expect(state()).toBe("shown"));
    expect(window.localStorage.getItem("cde.introSeen")).toBe("false");

    act(() => ui.setShowIntroModal(false));
    expect(window.localStorage.getItem("cde.introSeen")).toBe("true");
    expect(document.cookie).toBe("");
  });
});
