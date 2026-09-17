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
  // when the search is asked for, never on the way there.
  it("publishes the typed text on Enter, and nothing before it", async () => {
    let latest;
    const published = [];
    function Probe() {
      latest = useSelection();
      published.push(latest.datasetTitleSearchText);
      return null;
    }
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
    expect(latest.datasetTitleSearchText).toBe("");

    await user.type(box, "{Enter}");

    await waitFor(() => expect(latest.datasetTitleSearchText).toBe("temp"));
    expect([...new Set(published)]).toEqual(["", "temp"]);
  });

  it("publishes on the magnifier too — the button is the same submit", async () => {
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
      { providers: "app" },
    );

    await user.click(screen.getByTestId("topbar-search-toggle"));
    await user.type(
      screen.getByPlaceholderText("Search dataset titles"),
      "orca",
    );
    await user.click(screen.getByLabelText("Search"));

    await waitFor(() => expect(latest.datasetTitleSearchText).toBe("orca"));
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
