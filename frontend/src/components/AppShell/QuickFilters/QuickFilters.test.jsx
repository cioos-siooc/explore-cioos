import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import QuickFilters from "./QuickFilters.jsx";

// A rectangle and a free shape, as a share link delivers them: the two draw
// buttons read their pressed state off the shape on the map, so which one is
// lit is decided by these params alone (see polygonIsRectangle).
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
  // datasetTitleSearchText the datasets list does, and the draw buttons send
  // the same one-shot requestDraw the map already answers. Both are asserted
  // through that shared state rather than through the markup.
  function renderRow(url = "/") {
    const seen = { search: [], draw: [], onlyInView: [] };
    function Probe() {
      const { datasetTitleSearchText, onlyInView } = useSelection();
      const { drawRequest } = useMapState();
      seen.search.push(datasetTitleSearchText);
      seen.draw.push(drawRequest?.mode);
      seen.onlyInView.push(onlyInView);
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

  it.each([
    ["box", "quick-filter-box"],
    ["polygon", "quick-filter-polygon"],
  ])("asks the map to start a %s draw", async (mode, testId) => {
    const { user, seen } = renderRow();

    await user.click(screen.getByTestId(testId));

    await waitFor(() => expect(seen.draw.at(-1)).toBe(mode));
  });

  it("lights the tool that drew the shape that is up, and only that one", () => {
    renderRow(`/?${BOX}`);
    expect(screen.getByTestId("quick-filter-box")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("quick-filter-polygon")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("lights the polygon button for a shape that is not a rectangle", () => {
    renderRow(`/?${FREE_SHAPE}`);
    expect(screen.getByTestId("quick-filter-polygon")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("quick-filter-box")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  // Second click on the lit button is how the shape goes, rather than a clear
  // control appearing beside it.
  it("clears the drawn shape when its own button is pressed again", async () => {
    const { user, seen } = renderRow(`/?${BOX}`);

    await user.click(screen.getByTestId("quick-filter-box"));

    await waitFor(() => expect(seen.draw.at(-1)).toBe("clear"));
  });

  it("toggles the in-view narrowing", async () => {
    const { user, seen } = renderRow();
    const button = screen.getByTestId("quick-filter-in-view");
    expect(button).toHaveAttribute("aria-pressed", "false");

    await user.click(button);

    await waitFor(() => expect(seen.onlyInView.at(-1)).toBe(true));
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("offers no reset until something is set", () => {
    renderRow();
    expect(screen.queryByTestId("quick-filter-reset")).toBeNull();
  });

  it("drops every quick filter at once", async () => {
    const { user, seen } = renderRow(`/?search=temperature&onlyInView=true`);

    await user.click(screen.getByTestId("quick-filter-reset"));

    await waitFor(() => {
      expect(seen.search.at(-1)).toBe("");
      expect(seen.onlyInView.at(-1)).toBe(false);
      expect(seen.draw.at(-1)).toBe("clear");
    });
  });
});
