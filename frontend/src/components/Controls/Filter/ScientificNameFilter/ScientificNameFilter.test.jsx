import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../../test/mockFetch.js";
import ScientificNameFilter from "./ScientificNameFilter.jsx";

function mockScientificNamesSearch(results) {
  const realFetch = global.fetch;
  global.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("/scientificNames?q=")) {
      return Promise.resolve(
        new Response(JSON.stringify(results), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return realFetch(input, init);
  };
}

describe("ScientificNameFilter", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("shows the no-results message once an empty search settles", async () => {
    renderWithProviders(
      <ScientificNameFilter
        scientificNamesSelected={[]}
        setScientificNamesSelected={() => {}}
        searchTerms=""
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByText("No matching scientific or common names"),
      ).toBeInTheDocument(),
    );
  });

  it("shows a spinner while the search is in flight", () => {
    renderWithProviders(
      <ScientificNameFilter
        scientificNamesSelected={[]}
        setScientificNamesSelected={() => {}}
        searchTerms=""
      />,
    );
    expect(screen.getByText("Searching…")).toBeInTheDocument();
  });

  it("renders suggestions from /scientificNames once the debounce settles", async () => {
    mockScientificNamesSearch([
      {
        scientificName: "Orcinus orca",
        vernacular: "Killer whale",
        rank: "Species",
      },
    ]);
    renderWithProviders(
      <ScientificNameFilter
        scientificNamesSelected={[]}
        setScientificNamesSelected={() => {}}
        searchTerms="orca"
      />,
    );
    await waitFor(
      () => expect(screen.getByText("Orcinus orca")).toBeInTheDocument(),
      {
        timeout: 2000,
      },
    );
    // "Species · Killer whale" is one text node split across the rank/
    // separator/vernacular — no single element's own text is exactly
    // "Killer whale", so match on the detail row's combined content instead.
    expect(
      document.querySelector(".scientificNameOptionDetail"),
    ).toHaveTextContent("Killer whale");
  });

  it("filters out ranks too broad to search reliably (e.g. Order, Class)", async () => {
    mockScientificNamesSearch([
      { scientificName: "Decapoda", rank: "Order" },
      { scientificName: "Orcinus orca", rank: "Species" },
    ]);
    renderWithProviders(
      <ScientificNameFilter
        scientificNamesSelected={[]}
        setScientificNamesSelected={() => {}}
        searchTerms="x"
      />,
    );
    await waitFor(
      () => expect(screen.getByText("Orcinus orca")).toBeInTheDocument(),
      {
        timeout: 2000,
      },
    );
    expect(screen.queryByText("Decapoda")).not.toBeInTheDocument();
  });

  it("clicking an unselected suggestion adds it to the selection", async () => {
    const user = userEvent.setup();
    mockScientificNamesSearch([
      {
        scientificName: "Orcinus orca",
        vernacular: "Killer whale",
        rank: "Species",
      },
    ]);
    const setScientificNamesSelected = vi.fn();
    renderWithProviders(
      <ScientificNameFilter
        scientificNamesSelected={[]}
        setScientificNamesSelected={setScientificNamesSelected}
        searchTerms="orca"
      />,
    );
    const option = await screen.findByText(
      "Orcinus orca",
      {},
      { timeout: 2000 },
    );
    await user.click(option);
    expect(setScientificNamesSelected).toHaveBeenCalledWith(["Orcinus orca"]);
  });

  it("clicking a selected name removes it", async () => {
    const user = userEvent.setup();
    const setScientificNamesSelected = vi.fn();
    renderWithProviders(
      <ScientificNameFilter
        scientificNamesSelected={["Orcinus orca"]}
        setScientificNamesSelected={setScientificNamesSelected}
        searchTerms=""
      />,
    );
    const option = await screen.findByText("Orcinus orca");
    await user.click(option);
    expect(setScientificNamesSelected).toHaveBeenCalledWith([]);
  });

  it("pins already-selected names at the top, ahead of new suggestions", async () => {
    mockScientificNamesSearch([
      {
        scientificName: "Gadus morhua",
        vernacular: "Atlantic cod",
        rank: "Species",
      },
    ]);
    renderWithProviders(
      <ScientificNameFilter
        scientificNamesSelected={["Orcinus orca"]}
        setScientificNamesSelected={() => {}}
        searchTerms="cod"
      />,
    );
    await waitFor(
      () => expect(screen.getByText("Gadus morhua")).toBeInTheDocument(),
      { timeout: 2000 },
    );
    const names = [
      ...document.querySelectorAll(".scientificNameOptionName"),
    ].map((el) => el.textContent);
    expect(names.indexOf("Orcinus orca")).toBeLessThan(
      names.indexOf("Gadus morhua"),
    );
  });
});
