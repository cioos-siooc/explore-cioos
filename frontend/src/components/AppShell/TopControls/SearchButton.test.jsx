import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import SearchButton from "./SearchButton.jsx";

describe("SearchButton", () => {
  beforeEach(() => {
    installMockFetch();
  });

  // The popover writes the same datasetTitleSearchText the datasets list and
  // the Filters modal do, and that state re-queries the map — so it publishes
  // what is typed on a pause rather than per keystroke.
  it("publishes the typed text once, after typing pauses", async () => {
    let latest;
    const published = [];
    function Probe() {
      latest = useSelection();
      published.push(latest.datasetTitleSearchText);
      return null;
    }
    // No inter-keystroke delay, so the whole word is typed well inside the
    // debounce however loaded the machine running this is.
    const user = userEvent.setup({ delay: null });
    renderWithProviders(
      <>
        <SearchButton />
        <Probe />
      </>,
      { providers: "app" },
    );

    await user.click(screen.getByTestId("topbar-search-toggle"));
    const box = screen.getByPlaceholderText("Search dataset titles");
    await user.type(box, "temp");
    expect(box).toHaveValue("temp");

    await waitFor(() => expect(latest.datasetTitleSearchText).toBe("temp"));
    expect([...new Set(published)]).toEqual(["", "temp"]);
  });

  it("clears the search immediately, without waiting on the pause", async () => {
    let latest;
    function Probe() {
      latest = useSelection();
      return null;
    }
    const user = userEvent.setup({ delay: null });
    renderWithProviders(
      <>
        <SearchButton />
        <Probe />
      </>,
      { url: "/?search=temp", providers: "app" },
    );

    await user.click(screen.getByTestId("topbar-search-toggle"));
    expect(screen.getByPlaceholderText("Search dataset titles")).toHaveValue(
      "temp",
    );
    await user.click(screen.getByLabelText("Clear search terms"));

    expect(latest.datasetTitleSearchText).toBe("");
  });
});
