import * as React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import ActiveFilterChips from "../TopControls/ActiveFilterChips.jsx";
import QuickFilters from "./QuickFilters.jsx";

// A rectangle and a free shape, as a share link delivers them: the Area button
// reads its lit state and marked shape off the shape on the map, so both are
// decided by these params alone (see polygonIsRectangle).
const BOX = "latMin=40&lonMin=-70&latMax=50&lonMax=-60";
const FREE_SHAPE = `polygon=${encodeURIComponent(
  JSON.stringify([
    [-70, 40],
    [-60, 45],
    [-65, 50],
    [-70, 40],
  ]),
)}`;

describe("QuickFilters", () => {
  beforeEach(() => {
    installMockFetch();
  });

  // The row writes nothing of its own: the Area menu sends the same one-shot
  // requestDraw the map already answers, asserted through that shared state
  // rather than through the markup.
  function renderRow(url = "/") {
    const seen = { search: [], draw: [], onlyInView: [], realtimeOnly: [] };
    function Probe() {
      const { datasetTitleSearchText, onlyInView } = useSelection();
      const { drawRequest } = useMapState();
      const { realtimeOnly } = useFilters();
      seen.search.push(datasetTitleSearchText);
      seen.draw.push(drawRequest?.mode);
      seen.onlyInView.push(onlyInView);
      seen.realtimeOnly.push(realtimeOnly);
      return null;
    }
    const user = userEvent.setup({ delay: null });
    renderWithProviders(
      <>
        <QuickFilters />
        <Probe />
      </>,
      { url, providers: "app" },
    );
    return { user, seen };
  }

  const openArea = async (user) =>
    user.click(screen.getByTestId("quick-filter-area"));

  it.each([
    ["box", "quick-filter-area-box"],
    ["polygon", "quick-filter-area-polygon"],
  ])(
    "asks the map to start a %s draw from the Area menu",
    async (mode, testId) => {
      const { user, seen } = renderRow();
      await openArea(user);

      await user.click(screen.getByTestId(testId));

      await waitFor(() => expect(seen.draw.at(-1)).toBe(mode));
      expect(screen.queryByTestId("quick-filter-area-menu")).toBeNull();
      expect(screen.getByTestId("quick-filter-area")).toHaveFocus();
    },
  );

  it("keeps the Area menu closed until asked for, with nothing to clear", async () => {
    const { user } = renderRow();
    const button = screen.getByTestId("quick-filter-area");
    expect(screen.queryByTestId("quick-filter-area-menu")).toBeNull();
    expect(button).not.toHaveClass("applied");

    await openArea(user);

    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByTestId("quick-filter-area-clear")).toBeNull();
  });

  it.each([
    ["a rectangle", BOX, "quick-filter-area-box", "quick-filter-area-polygon"],
    [
      "a free shape",
      FREE_SHAPE,
      "quick-filter-area-polygon",
      "quick-filter-area-box",
    ],
  ])("marks the shape that drew %s", async (_, params, on, off) => {
    const { user } = renderRow(`/?${params}`);
    expect(screen.getByTestId("quick-filter-area")).toHaveClass("applied");

    await openArea(user);

    expect(screen.getByTestId(on)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId(off)).toHaveAttribute("aria-pressed", "false");
  });

  it("clears the drawn shape from the Area menu", async () => {
    const { user, seen } = renderRow(`/?${BOX}`);
    await openArea(user);

    await user.click(screen.getByTestId("quick-filter-area-clear"));

    await waitFor(() => expect(seen.draw.at(-1)).toBe("clear"));
  });

  it("closes the Area menu on Escape and on a click elsewhere", async () => {
    const { user, seen } = renderRow();
    await openArea(user);
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("quick-filter-area-menu")).toBeNull();
    expect(screen.getByTestId("quick-filter-area")).toHaveFocus();

    await openArea(user);
    await user.click(document.body);
    expect(screen.queryByTestId("quick-filter-area-menu")).toBeNull();
    expect(seen.draw.filter(Boolean)).toEqual([]);
  });

  it("toggles the in-view narrowing", async () => {
    const { user, seen } = renderRow();
    const button = screen.getByTestId("quick-filter-in-view");
    expect(button).toHaveAttribute("aria-pressed", "false");

    await user.click(button);

    await waitFor(() => expect(seen.onlyInView.at(-1)).toBe(true));
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("toggles the real-time narrowing", async () => {
    const { user, seen } = renderRow();
    const button = screen.getByTestId("quick-filter-realtime");
    expect(button).toHaveAttribute("aria-pressed", "false");

    await user.click(button);

    await waitFor(() => expect(seen.realtimeOnly.at(-1)).toBe(true));
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  // The param is only ever written when the toggle is on; an explicit false
  // must read as "not filtering", not as a second state to show.
  it.each([
    ["true", "true"],
    ["false", "false"],
  ])("reads realtimeOnly=%s from the link", async (param, pressed) => {
    renderRow(`/?realtimeOnly=${param}`);
    await waitFor(() =>
      expect(screen.getByTestId("quick-filter-realtime")).toHaveAttribute(
        "aria-pressed",
        pressed,
      ),
    );
  });

  it("keeps the reset in place but disabled until something is set", () => {
    renderRow();
    expect(screen.getByTestId("quick-filter-reset")).toBeDisabled();
  });

  it("enables the reset once anything is set", () => {
    renderRow("/?realtimeOnly=true");
    expect(screen.getByTestId("quick-filter-reset")).toBeEnabled();
  });

  it("is named for assistive tech", () => {
    renderRow();
    expect(
      screen.getByRole("group", { name: "Quick filters" }),
    ).toBeInTheDocument();
  });

  it("badges the real-time button with how many listed datasets are real-time", async () => {
    const mockedFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input) => {
      const response = await mockedFetch(input);
      const url = typeof input === "string" ? input : input.url;
      if (!url.includes("/pointQuery")) return response;
      const rows = (await response.json()).map((row, i) => ({
        ...row,
        is_realtime: i < 3,
      }));
      return new Response(JSON.stringify(rows), { status: 200 });
    });
    expect(screen.queryByTestId("quick-filter-realtime-count")).toBeNull();
    renderRow();

    const badge = await screen.findByTestId("quick-filter-realtime-count");
    await waitFor(() => expect(badge).toHaveTextContent("3"));
    expect(
      screen.getByTestId("quick-filter-realtime"),
    ).toHaveAccessibleDescription("3");
    expect(
      screen.getByTestId("quick-filter-in-view-count"),
    ).toBeInTheDocument();
  });

  it("shortens a big count on the badge but describes the button with it in full", async () => {
    const mockedFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input) => {
      const response = await mockedFetch(input);
      const url = typeof input === "string" ? input : input.url;
      if (!url.includes("/pointQuery")) return response;
      const [row] = await response.json();
      const rows = Array.from({ length: 2150 }, (_, i) => ({
        ...row,
        pk: i + 1,
        is_realtime: true,
      }));
      return new Response(JSON.stringify(rows), { status: 200 });
    });
    renderRow();

    const badge = await screen.findByTestId("quick-filter-realtime-count");
    await waitFor(() => expect(badge).toHaveTextContent("2.2K"));
    expect(
      screen.getByTestId("quick-filter-realtime"),
    ).toHaveAccessibleDescription("2,150");
  });

  it("drops every quick filter at once", async () => {
    const { user, seen } = renderRow(
      `/?search=temperature&onlyInView=true&realtimeOnly=true`,
    );

    await user.click(screen.getByTestId("quick-filter-reset"));

    await waitFor(() => {
      expect(seen.search.at(-1)).toBe("");
      expect(seen.onlyInView.at(-1)).toBe(false);
      expect(seen.realtimeOnly.at(-1)).toBe(false);
      expect(seen.draw.at(-1)).toBe("clear");
    });
  });

  // There is only the one reset, for the modal filters the chips show and the
  // quick ones together — mounted alongside ActiveFilterChips here rather than
  // in that component's own tests, since it renders no reset of its own.
  it("the single reset clears the modal filter along with the quick ones", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithProviders(
      <>
        <QuickFilters />
        <ActiveFilterChips />
      </>,
      { url: "/?eovs=oxygen&onlyInView=true", providers: "app" },
    );
    await waitFor(() =>
      expect(screen.queryAllByTestId("filter-chip-group")).toHaveLength(1),
    );

    await user.click(screen.getByTestId("quick-filter-reset"));

    await waitFor(() =>
      expect(screen.queryAllByTestId("filter-chip-group")).toHaveLength(0),
    );
    expect(screen.getByTestId("quick-filter-in-view")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
