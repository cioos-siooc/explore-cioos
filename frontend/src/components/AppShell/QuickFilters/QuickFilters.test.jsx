import * as React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
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
  function renderRow(url = "/", { withChips = false } = {}) {
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
        {withChips && <ActiveFilterChips />}
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

  it("names how many datasets the view holds on the in-view button", async () => {
    // The fixture rows carry no bbox; give every one the same point so a
    // world-sized viewport has them all in view.
    const mockedFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input) => {
      const response = await mockedFetch(input);
      const url = typeof input === "string" ? input : input.url;
      if (!url.includes("/pointQuery")) return response;
      const rows = (await response.json()).map((row) => ({
        ...row,
        filtered_bbox_geojson: { type: "Point", coordinates: [-63, 44] },
      }));
      return new Response(JSON.stringify(rows), { status: 200 });
    });
    const latest = {};
    function ViewProbe() {
      latest.setMapView = useMapState().setMapView;
      latest.points = useSelection().pointsData;
      return null;
    }
    renderWithProviders(
      <>
        <QuickFilters />
        <ViewProbe />
      </>,
      { providers: "app" },
    );
    await waitFor(() => expect(latest.points.length).toBeGreaterThan(0));

    act(() =>
      latest.setMapView((view) => ({
        ...view,
        bounds: [
          [-180, -90],
          [180, 90],
        ],
      })),
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("quick-filter-in-view-count"),
      ).toHaveTextContent(String(latest.points.length)),
    );
  });

  it("names how many datasets are real-time on the real-time button", async () => {
    const mockedFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input) => {
      const response = await mockedFetch(input);
      const url = typeof input === "string" ? input : input.url;
      if (!url.includes("/pointQuery")) return response;
      const rows = (await response.json()).map((row, i) => ({
        ...row,
        is_realtime: i < 2,
      }));
      return new Response(JSON.stringify(rows), { status: 200 });
    });
    renderRow();

    await waitFor(() =>
      expect(
        screen.getByTestId("quick-filter-realtime-count"),
      ).toHaveTextContent("2"),
    );
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

  it("holds Clear all in the row while only quick filters are set", async () => {
    const { user, seen } = renderRow("/?onlyInView=true&realtimeOnly=true");
    const row = screen.getByTestId("quick-filters");

    await user.click(within(row).getByTestId("filter-chips-clear-all"));

    await waitFor(() => {
      expect(seen.onlyInView.at(-1)).toBe(false);
      expect(seen.realtimeOnly.at(-1)).toBe(false);
    });
    expect(within(row).queryByTestId("filter-chips-clear-all")).toBeNull();
  });

  it("leaves Clear all to the chips once another filter is set", async () => {
    renderRow("/?realtimeOnly=true&eovs=oxygen", { withChips: true });
    const chips = await screen.findByTestId("active-filter-chips");

    expect(within(chips).getByTestId("filter-chips-clear-all")).toBeVisible();
    expect(
      within(screen.getByTestId("quick-filters")).queryByTestId(
        "filter-chips-clear-all",
      ),
    ).toBeNull();
  });

  it("is named as a group for assistive tech", () => {
    renderRow();
    expect(
      screen.getByRole("group", { name: "Quick filters" }),
    ).toBeInTheDocument();
  });

  it("is cleared along with everything else by the chips' Clear all", async () => {
    const { user, seen } = renderRow(
      `/?search=temperature&onlyInView=true&realtimeOnly=true`,
      { withChips: true },
    );

    await user.click(await screen.findByTestId("filter-chips-clear-all"));

    await waitFor(() => {
      expect(seen.search.at(-1)).toBe("");
      expect(seen.onlyInView.at(-1)).toBe(false);
      expect(seen.realtimeOnly.at(-1)).toBe(false);
      expect(seen.draw.at(-1)).toBe("clear");
    });
  });

  it("Clear all drops the modal filter along with the quick ones", async () => {
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

    await user.click(screen.getByTestId("filter-chips-clear-all"));

    await waitFor(() =>
      expect(screen.queryAllByTestId("filter-chip-group")).toHaveLength(0),
    );
    expect(screen.getByTestId("quick-filter-in-view")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
