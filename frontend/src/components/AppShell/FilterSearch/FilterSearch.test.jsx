import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import { defaultStartDate, defaultEndDate } from "../../config.js";
import FilterSearch from "./FilterSearch.jsx";

describe("FilterSearch", () => {
  beforeEach(() => {
    installMockFetch();
  });

  // The palette writes nothing of its own: every pick lands in the provider
  // state the classic filters read, so it is asserted through that state.
  async function renderPalette(url = "/") {
    const seen = {};
    function Probe() {
      const { eovsSelected, realtimeOnly, ...filters } = useFilters();
      seen.time = [filters.startDate, filters.endDate];
      seen.depth = [filters.startDepth, filters.endDepth];
      const oxygen = eovsSelected.find((e) => e.title === "oxygen");
      seen.oxygen = oxygen && {
        isSelected: oxygen.isSelected,
        isExcluded: oxygen.isExcluded,
      };
      seen.realtimeOnly = realtimeOnly;
      seen.dataLayerChoices = useMapState().dataLayerChoices;
      seen.search = useSelection().datasetTitleSearchText;
      const ui = useUI();
      seen.ui = {
        showFilterSearch: ui.showFilterSearch,
        showFiltersModal: ui.showFiltersModal,
        openFilter: ui.openFilter,
      };
      return null;
    }
    const user = userEvent.setup({ delay: null });
    renderWithProviders(
      <>
        <FilterSearch />
        <Probe />
      </>,
      { url, providers: "app" },
    );
    await waitFor(() => expect(seen.oxygen).toBeDefined());
    await user.keyboard("{Control>}k{/Control}");
    const box = await screen.findByTestId("filter-search-input");
    await waitFor(() => expect(box).toHaveFocus());
    return { user, seen, box };
  }

  const options = () => screen.getAllByTestId("filter-search-option");
  const option = (name) =>
    within(screen.getByRole("listbox"))
      .getByText(name)
      .closest("[role=option]");

  it("opens when typing starts on the page, holding what was typed", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<FilterSearch />, { providers: "app" });

    await user.keyboard("oxy");

    const box = await screen.findByTestId("filter-search-input");
    await waitFor(() => expect(box).toHaveValue("oxy"));
  });

  it("leaves typing in a field, shortcuts and symbols alone", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithProviders(
      <>
        <input aria-label="elsewhere" />
        <FilterSearch />
      </>,
      { providers: "app" },
    );

    await user.click(screen.getByLabelText("elsewhere"));
    await user.keyboard("abc");
    expect(screen.getByLabelText("elsewhere")).toHaveValue("abc");
    await user.click(document.body);
    await user.keyboard("{Control>}c{/Control}+-=");

    expect(screen.queryByTestId("filter-search-input")).toBeNull();
  });

  it("opens on Ctrl+K", async () => {
    const { seen } = await renderPalette();
    expect(seen.ui.showFilterSearch).toBe(true);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("toggles a value without disturbing the list, so more can be picked", async () => {
    const { user, seen, box } = await renderPalette();

    await user.type(box, "oxyg");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(seen.oxygen).toEqual({ isSelected: true, isExcluded: false });
    expect(box).toHaveValue("oxyg");
    expect(option("Oxygen")).toHaveAttribute("data-state", "include");
    expect(option("Oxygen")).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Enter}");
    expect(seen.oxygen).toEqual({ isSelected: false, isExcluded: false });
    expect(option("Oxygen")).toHaveAttribute("data-state", "none");
  });

  it("excludes instead with a leading -", async () => {
    const { user, seen, box } = await renderPalette();

    await user.type(box, "-oxyg{Enter}");

    expect(seen.oxygen).toEqual({ isSelected: false, isExcluded: true });
  });

  it("excludes with a leading not, too", async () => {
    const { user, seen, box } = await renderPalette();

    await user.type(box, "not oxyg{Enter}");

    expect(seen.oxygen).toEqual({ isSelected: false, isExcluded: true });
  });

  it("finds an ocean variable by its readable name in either language", async () => {
    const { user, box } = await renderPalette();

    await user.type(box, "température sous");

    expect(option("Subsurface temperature")).toBeInTheDocument();
  });

  it("offers the typed text as a title search first", async () => {
    const { user, seen, box } = await renderPalette();

    await user.type(box, "argo{Enter}");
    expect(seen.search).toBe("argo");
    await user.keyboard("{Enter}");
    expect(seen.search).toBe("");
  });

  it("toggles the switches and geometry layers by name", async () => {
    const { user, seen, box } = await renderPalette();

    await user.type(box, "real-time");
    await user.click(option("Real-time datasets only"));
    expect(seen.realtimeOnly).toBe(true);

    await user.clear(box);
    await user.type(box, "-profile");
    await user.click(
      within(screen.getByRole("listbox")).getAllByText("Profile")[0],
    );
    expect(seen.dataLayerChoices).toEqual({ profile: "exclude" });
  });

  it("lists what is applied when empty, and keeps a removed value listed", async () => {
    const { user, seen } = await renderPalette("/?eovs=oxygen");
    await waitFor(() => expect(seen.oxygen?.isSelected).toBe(true));

    expect(options()).toHaveLength(1);
    expect(options()[0]).toHaveTextContent("Oxygen");
    expect(options()[0]).toHaveTextContent("Remove");

    await user.click(options()[0]);
    expect(seen.oxygen).toEqual({ isSelected: false, isExcluded: false });
    expect(options()).toHaveLength(1);
    expect(options()[0]).toHaveAttribute("data-state", "none");

    await user.click(options()[0]);
    expect(seen.oxygen).toEqual({ isSelected: true, isExcluded: false });
  });

  it("explains itself when nothing is applied", async () => {
    await renderPalette();
    expect(screen.getByText(/Find any filter by name/)).toBeInTheDocument();
  });

  it("applies a typed time range, and a typed depth range", async () => {
    const { user, seen, box } = await renderPalette();

    await user.type(box, "2010-2020");
    expect(options()[0]).toHaveTextContent("2010-01-01 – 2020-12-31");
    await user.keyboard("{Enter}");
    expect(seen.time).toEqual(["2010-01-01", "2020-12-31"]);
    await user.keyboard("{Enter}");
    expect(seen.time).toEqual([defaultStartDate, defaultEndDate]);

    await user.clear(box);
    await user.type(box, "below 200m{Enter}");
    expect(seen.depth).toEqual([200, 12000]);
  });

  it("suggests a time range while it is still being typed", async () => {
    const { user, box } = await renderPalette();

    await user.type(box, "from 2022 to 20");
    expect(options()[0]).toHaveTextContent(`2022-01-01 – ${defaultEndDate}`);
    await user.type(box, "25");
    expect(options()[0]).toHaveTextContent("2022-01-01 – 2025-12-31");
  });

  it("describes each result, and links the active one to its filter", async () => {
    const { user, seen, box } = await renderPalette();

    await user.type(box, "oxyg");
    expect(option("Oxygen")).toHaveTextContent(
      "The amount of dissolved oxygen in seawater.",
    );
    await user.keyboard("{ArrowDown}");
    expect(screen.getByTestId("filter-search-open-panel")).toHaveTextContent(
      "Open in Filters: Ocean Variables",
    );

    await user.click(screen.getByTestId("filter-search-open-panel"));
    expect(seen.ui).toEqual({
      showFilterSearch: false,
      showFiltersModal: true,
      openFilter: "oceanVariablesFiltername",
    });
  });

  it("empties the box on Escape, and closes on the next", async () => {
    const { user, seen, box } = await renderPalette();

    await user.type(box, "zzzz");
    await user.keyboard("{Escape}");
    expect(box).toHaveValue("");
    expect(seen.ui.showFilterSearch).toBe(true);
    await user.keyboard("{Escape}");
    expect(seen.ui.showFilterSearch).toBe(false);
  });
});
