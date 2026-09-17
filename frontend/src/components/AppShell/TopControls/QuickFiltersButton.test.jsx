import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import QuickFiltersButton from "./QuickFiltersButton.jsx";

describe("QuickFiltersButton", () => {
  beforeEach(() => {
    installMockFetch();
  });

  // The caret's two halves write nothing of their own: the search row writes
  // the same datasetTitleSearchText the datasets list and the Filters modal
  // do, and the draw rows send the same one-shot requestDraw the modal's Area
  // pane does. Both are asserted through that shared state rather than
  // through the menu.
  function renderMenu(url = "/") {
    const seen = { search: [], draw: [] };
    function Probe() {
      const { datasetTitleSearchText } = useSelection();
      const { drawRequest } = useMapState();
      seen.search.push(datasetTitleSearchText);
      seen.draw.push(drawRequest?.mode);
      return null;
    }
    // No inter-keystroke delay, so a whole word is typed well inside the
    // debounce however loaded the machine running this is.
    const user = userEvent.setup({ delay: null });
    renderWithProviders(
      <>
        <QuickFiltersButton />
        <Probe />
      </>,
      { url, providers: "app" },
    );
    return { user, seen };
  }

  it("publishes the typed text once, after typing pauses", async () => {
    const { user, seen } = renderMenu();

    await user.click(screen.getByTestId("topbar-quick-filters-toggle"));
    await user.type(
      screen.getByPlaceholderText("Search dataset titles"),
      "temp",
    );

    await waitFor(() => expect(seen.search.at(-1)).toBe("temp"));
    // The whole word published in one go, not one publish per keystroke — the
    // search reaches the map, the counts and the datasets list, so no
    // intermediate "t"/"te"/"tem" may ever have been seen.
    expect([...new Set(seen.search)]).toEqual(["", "temp"]);
  });

  // The other half of the debounce: clearing is not a pause to wait out, it
  // is the user asking for the unfiltered view back now.
  it("clears the search immediately, without waiting on the pause", async () => {
    const { user, seen } = renderMenu("/?search=temp");

    await user.click(screen.getByTestId("topbar-quick-filters-toggle"));
    expect(screen.getByPlaceholderText("Search dataset titles")).toHaveValue(
      "temp",
    );
    await user.click(screen.getByLabelText("Clear search terms"));

    expect(seen.search.at(-1)).toBe("");
  });

  // The menu stays up while typing: its search row is deliberately not a
  // Dropdown.Item, which would close it on the first keystroke.
  it("keeps the menu open while the search row is used", async () => {
    const { user } = renderMenu();

    await user.click(screen.getByTestId("topbar-quick-filters-toggle"));
    const box = screen.getByPlaceholderText("Search dataset titles");
    await user.type(box, "temp");

    expect(box).toBeInTheDocument();
    expect(screen.getByText("Bounding box")).toBeInTheDocument();
  });

  it("asks the map to start a draw, and closes so the map is there to draw on", async () => {
    const { user, seen } = renderMenu();

    await user.click(screen.getByTestId("topbar-quick-filters-toggle"));
    await user.click(screen.getByText("Polygon"));

    await waitFor(() => expect(seen.draw.at(-1)).toBe("polygon"));
    expect(screen.queryByText("Polygon")).not.toBeInTheDocument();
  });

  // Nothing drawn yet, so opening the menu must not arm a tool on its own —
  // unlike the dedicated draw button this replaced, where opening the menu
  // *was* the start of a draw. Here it may equally be the start of a search.
  it("does not start a draw merely by opening", async () => {
    const { user, seen } = renderMenu();

    await user.click(screen.getByTestId("topbar-quick-filters-toggle"));

    expect(seen.draw.filter(Boolean)).toEqual([]);
  });
});
