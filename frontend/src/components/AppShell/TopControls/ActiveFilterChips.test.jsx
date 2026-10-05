import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import ActiveFilterChips from "./ActiveFilterChips.jsx";

// Seeded entirely through the address, the way a share link arrives: every
// provider reads its slice out of window.location, so one URL sets up the
// filters, the map camera and the list's own narrowing at once.
function open(search) {
  return renderWithProviders(<ActiveFilterChips />, {
    url: `/?${search}`,
    providers: "app",
  });
}

const groups = () => screen.queryAllByTestId("filter-chip-group");
// Chips are addressed by which filter they belong to, never by position: the
// groups render in a fixed order today, but that is a layout decision and not
// something these assertions should depend on.
const group = (key) => document.querySelector(`[data-filter-key="${key}"]`);

describe("ActiveFilterChips", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("renders nothing at all when no filter is narrowing anything", async () => {
    open("lat=63.3&lon=-95.9&zoom=2.75");
    // Give the catalogue fetches a chance to land and still show no chips.
    await waitFor(() =>
      expect(screen.queryByTestId("active-filter-chips")).toBeNull(),
    );
  });

  it("announces a filter carried in the link", async () => {
    open("eovs=oxygen");
    await waitFor(() => expect(groups()).toHaveLength(1));

    const eovs = group("eovs");
    expect(eovs).toBeInTheDocument();
    // The chip carries the translated display name, not the raw ?eovs= key.
    expect(within(eovs).getByTestId("filter-chip-item")).toHaveTextContent(
      "Oxygen",
    );
  });

  it("marks an excluded value with a NOT tag, apart from the included ones", async () => {
    open("eovs=oxygen&excludeEovs=subSurfaceTemperature&excludeLayers=grid");
    await waitFor(() => expect(groups().length).toBeGreaterThanOrEqual(2));

    const [included, excluded] = within(group("eovs")).getAllByTestId(
      "filter-chip-item",
    );
    expect(included).toHaveAttribute("data-excluded", "false");
    expect(included).not.toHaveTextContent(/not/i);
    expect(excluded).toHaveAttribute("data-excluded", "true");
    expect(excluded.querySelector(".activeFilterItemNot")).toHaveTextContent(
      "not",
    );
    // Its remove button names the whole thing, "not" included.
    expect(within(excluded).getByRole("button")).toHaveAccessibleName(/: not /);
    // Geometry chips follow the same rule.
    expect(
      within(group("dataLayers")).getByTestId("filter-chip-item"),
    ).toHaveAttribute("data-excluded", "true");
  });

  it("gives one group per filter and one item per chosen value", async () => {
    open("eovs=oxygen,subSurfaceTemperature&platforms=mooring");
    await waitFor(() => expect(groups().length).toBeGreaterThanOrEqual(2));

    expect(
      within(group("eovs")).getAllByTestId("filter-chip-item"),
    ).toHaveLength(2);
    expect(
      within(group("platforms")).getAllByTestId("filter-chip-item"),
    ).toHaveLength(1);
  });

  it("folds a group's values beyond the visible cap behind a +N chip", async () => {
    open("eovs=oxygen,subSurfaceTemperature,seaState,nutrients");
    await waitFor(() => expect(groups()).toHaveLength(1));

    const eovs = group("eovs");
    expect(within(eovs).getAllByTestId("filter-chip-item")).toHaveLength(2);
    expect(within(eovs).getByTestId("filter-chip-more")).toHaveTextContent(
      "+2",
    );
  });

  it("reveals a group's folded values when its +N chip is clicked", async () => {
    const { user } = open(
      "eovs=oxygen,subSurfaceTemperature,seaState,nutrients",
    );
    await waitFor(() => expect(groups()).toHaveLength(1));

    const eovs = group("eovs");
    await user.click(within(eovs).getByTestId("filter-chip-more"));

    await waitFor(() =>
      expect(within(eovs).getAllByTestId("filter-chip-item")).toHaveLength(4),
    );
    expect(within(eovs).queryByTestId("filter-chip-more")).toBeNull();
  });

  it("folds a group's values back when its −N chip is clicked", async () => {
    const { user } = open(
      "eovs=oxygen,subSurfaceTemperature,seaState,nutrients",
    );
    await waitFor(() => expect(groups()).toHaveLength(1));

    const eovs = group("eovs");
    await user.click(within(eovs).getByTestId("filter-chip-more"));
    await waitFor(() =>
      expect(within(eovs).getByTestId("filter-chip-less")).toBeInTheDocument(),
    );

    await user.click(within(eovs).getByTestId("filter-chip-less"));

    await waitFor(() =>
      expect(within(eovs).getAllByTestId("filter-chip-item")).toHaveLength(2),
    );
    expect(within(eovs).getByTestId("filter-chip-more")).toHaveTextContent(
      "+2",
    );
    expect(within(eovs).queryByTestId("filter-chip-less")).toBeNull();
  });

  it("drops one value without touching the rest of its group", async () => {
    const { user } = open("eovs=oxygen,subSurfaceTemperature");
    await waitFor(() => expect(groups()).toHaveLength(1));

    const items = within(group("eovs")).getAllByTestId("filter-chip-item");
    await user.click(within(items[0]).getByTestId("filter-chip-item-remove"));

    await waitFor(() =>
      expect(
        within(group("eovs")).getAllByTestId("filter-chip-item"),
      ).toHaveLength(1),
    );
  });

  it("clears a whole group from its trailing x", async () => {
    const { user } = open("eovs=oxygen&platforms=mooring");
    await waitFor(() => expect(groups().length).toBeGreaterThanOrEqual(2));

    await user.click(
      within(group("eovs")).getByTestId("filter-chip-group-remove"),
    );

    await waitFor(() => expect(group("eovs")).toBeNull());
    // The other group is untouched — clearing one filter is not a reset.
    expect(group("platforms")).toBeInTheDocument();
  });

  it("gives each remove button a name that says what it removes", async () => {
    // They all read "Remove filter" before, which matched every chip at once —
    // ambiguous for a test and useless to a screen reader.
    open("eovs=oxygen&platforms=mooring");
    await waitFor(() => expect(groups().length).toBeGreaterThanOrEqual(2));

    const names = screen
      .getAllByTestId("filter-chip-item-remove")
      .map((button) => button.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(names.length);
    expect(names.some((name) => name.includes("Oxygen"))).toBe(true);
  });

  // A quick filter's own button lights up instead (see QuickFilters).
  it("leaves the quick filters to their buttons", async () => {
    open(
      "search=temperature&onlyInView=true&realtimeOnly=true&latMin=48.0000&lonMin=-130.0000&latMax=55.0000&lonMax=-120.0000",
    );
    await waitFor(() => expect(groups()).toHaveLength(1));
    expect(
      within(group("text")).getByTestId("filter-chip-item"),
    ).toHaveTextContent("temperature");
    expect(group("inView")).toBeNull();
    expect(group("area")).toBeNull();
    expect(group("realtime")).toBeNull();
  });

  it("shows no row for quick filters alone", async () => {
    open("onlyInView=true&realtimeOnly=true");
    await waitFor(() =>
      expect(screen.queryByTestId("active-filter-chips")).toBeNull(),
    );
  });

  // The title search has no row of its own in the Filters modal: its chip
  // opens the search palette on the term instead.
  it("opens the search palette from the title search's chip", async () => {
    const seen = {};
    function UIProbe() {
      const { showFiltersModal, filterSearchText } = useUI();
      Object.assign(seen, { showFiltersModal, filterSearchText });
      return null;
    }
    const user = userEvent.setup({ delay: null });
    renderWithProviders(
      <>
        <ActiveFilterChips />
        <UIProbe />
      </>,
      { url: "/?search=temperature", providers: "app" },
    );
    await waitFor(() => expect(group("text")).toBeInTheDocument());

    await user.click(within(group("text")).getByTestId("filter-chip-label"));

    expect(seen).toEqual({
      showFiltersModal: true,
      filterSearchText: "temperature",
    });
  });
});
