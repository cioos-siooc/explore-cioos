import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
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

  // The row writes nothing of its own: the search publishes the same
  // datasetTitleSearchText the datasets list does, and the Area menu sends
  // the same one-shot requestDraw the map already answers. Both are asserted
  // through that shared state rather than through the markup.
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

  const openSearch = async (user) =>
    user.click(screen.getByTestId("quick-filter-search"));

  it("keeps the search field away until it is asked for", async () => {
    renderRow();
    expect(screen.queryByTestId("quick-filter-search-input")).toBeNull();
    expect(screen.getByTestId("quick-filter-search")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  // The search reaches the map, the counts and the datasets list, so it
  // publishes when asked for — Enter — never on a pause mid-word.
  it("publishes the typed text on Enter, and nothing before it", async () => {
    const { user, seen } = renderRow();
    await openSearch(user);

    const box = screen.getByTestId("quick-filter-search-input");
    await user.type(box, "temp");
    expect(seen.search.at(-1)).toBe("");

    await user.type(box, "{Enter}");

    await waitFor(() => expect(seen.search.at(-1)).toBe("temp"));
    expect([...new Set(seen.search)]).toEqual(["", "temp"]);
  });

  it("publishes on the magnifier too — open, it is the same submit", async () => {
    const { user, seen } = renderRow();
    await openSearch(user);

    await user.type(screen.getByTestId("quick-filter-search-input"), "temp");
    await user.click(screen.getByTestId("quick-filter-search"));

    await waitFor(() => expect(seen.search.at(-1)).toBe("temp"));
  });

  // The hook lives in the row rather than in the field, so a word typed and
  // then abandoned is neither published nor lost.
  it("does not search for a draft abandoned by closing the field", async () => {
    const { user, seen } = renderRow();
    await openSearch(user);

    await user.type(screen.getByTestId("quick-filter-search-input"), "temp");
    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByTestId("quick-filter-search-input")).toBeNull(),
    );
    expect([...new Set(seen.search)]).toEqual([""]);

    // ...and it is still there on the way back in.
    await openSearch(user);
    expect(screen.getByTestId("quick-filter-search-input")).toHaveValue("temp");
  });

  it("closes the empty field when focus leaves it", async () => {
    const { user } = renderRow();
    await openSearch(user);

    await user.click(document.body);

    await waitFor(() =>
      expect(screen.queryByTestId("quick-filter-search-input")).toBeNull(),
    );
  });

  it("keeps the field open on blur while a draft is still in it", async () => {
    const { user } = renderRow();
    await openSearch(user);

    await user.type(screen.getByTestId("quick-filter-search-input"), "temp");
    await user.click(document.body);

    expect(screen.getByTestId("quick-filter-search-input")).toBeInTheDocument();
  });

  it("does not close moving focus to its own clear button", async () => {
    const { user } = renderRow("/?search=temperature");

    screen.getByTestId("quick-filter-search-input").focus();
    await user.tab();

    expect(screen.getByTestId("quick-filter-search-clear")).toHaveFocus();
    expect(screen.getByTestId("quick-filter-search-input")).toBeInTheDocument();
  });

  it("holds the field open for a term carried in the link", async () => {
    renderRow("/?search=temperature");
    const box = screen.getByTestId("quick-filter-search-input");
    expect(box).toHaveValue("temperature");
    // Opened by the term rather than by a press, so the caret is left wherever
    // the page put it.
    expect(box).not.toHaveFocus();
  });

  it("clears the search immediately, without waiting to be submitted", async () => {
    const { user, seen } = renderRow("/?search=temperature");

    await user.click(screen.getByTestId("quick-filter-search-clear"));

    await waitFor(() => expect(seen.search.at(-1)).toBe(""));
    expect(screen.queryByTestId("quick-filter-search-input")).toBeNull();
  });

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

  it("is named by its visible label", () => {
    renderRow();
    expect(
      screen.getByRole("group", { name: "Quick filters" }),
    ).toBeInTheDocument();
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

  // The reset button is the same one tested above (quick-filter-reset):
  // there is only the one, for the modal filters the chips show and the
  // quick ones together — mounted alongside ActiveFilterChips here rather
  // than in that component's own tests, since it renders no reset of its
  // own. The Show/Hide toggle for both rows now rides on the main Filters
  // button instead (see TopControls.test.jsx).
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
