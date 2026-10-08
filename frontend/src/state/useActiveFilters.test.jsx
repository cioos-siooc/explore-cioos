import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../test/renderWithProviders.jsx";
import { installMockFetch } from "../test/mockFetch.js";
import useActiveFilters from "./useActiveFilters.js";

let latest;

function Probe() {
  latest = useActiveFilters();
  return <span data-testid="keys">{latest.map((f) => f.key).join(",")}</span>;
}

const group = (key) => latest.find((f) => f.key === key);

// Seeded through the address, the way a share link arrives: one URL sets up
// the catalogue facets, the map camera and the list's own narrowing at once.
function open(search) {
  return renderWithProviders(<Probe />, {
    url: `/?${search}`,
    providers: "app",
  });
}

const keys = () => {
  const text = screen.getByTestId("keys").textContent;
  return text ? text.split(",") : [];
};

describe("useActiveFilters", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("lists nothing while nothing is narrowing the map", async () => {
    open("lat=63.3&lon=-95.9&zoom=2.75");
    // Give the catalogue fetches a chance to land and still list nothing.
    await waitFor(() => expect(screen.getByTestId("keys")).toBeInTheDocument());
    expect(keys()).toEqual([]);
  });

  it("lists one group per active catalogue facet", async () => {
    open("eovs=oxygen&platforms=mooring");
    await waitFor(() =>
      expect(keys().sort()).toEqual(["eovs", "platforms"].sort()),
    );
  });

  // Every server ticked is the ERDDAP row's doing, so it reads as that one
  // filter rather than one chip per server.
  it("lists a whole source kind as one item", async () => {
    open("includeObis=false");
    await waitFor(() => expect(keys()).toEqual(["sources"]));
    expect(group("sources").items).toMatchObject([{ label: "ERDDAP" }]);
  });

  // The geometry layers live in MapState rather than FilterProvider, which is
  // why the count the Filters badge shows used to come up short when one was
  // on.
  it("counts a narrowed geometry selection", async () => {
    open("layers=profile");
    await waitFor(() => expect(keys()).toContain("dataLayers"));
  });

  // The quick filters light their own buttons too, but a chip is what names
  // the value (the title term, the shape) and drops it, the same way it does
  // for every other filter.
  it("lists the quick filters like any other", async () => {
    open(
      "search=temperature&onlyInView=true&latMin=48.0000&lonMin=-130.0000&latMax=55.0000&lonMax=-120.0000",
    );
    await waitFor(() =>
      expect(keys().sort()).toEqual(["area", "inView", "text"].sort()),
    );
    expect(group("text").items).toMatchObject([{ label: "“temperature”" }]);
  });

  it("counts every one together", async () => {
    open(
      "eovs=oxygen&layers=profile&onlyInView=true&latMin=48.0000&lonMin=-130.0000&latMax=55.0000&lonMax=-120.0000",
    );
    await waitFor(() =>
      expect(keys().sort()).toEqual(
        ["area", "dataLayers", "eovs", "inView"].sort(),
      ),
    );
  });

  it("marks an excluded value, in the lists and the species alike", async () => {
    open("excludePlatforms=mooring&excludeScientificNames=Orcinus%20orca");
    await waitFor(() => expect(group("platforms")).toBeDefined());
    expect(group("platforms").items).toMatchObject([
      { label: "Mooring", excluded: true },
    ]);
    await waitFor(() => expect(group("scientificName")).toBeDefined());
    expect(group("scientificName").items).toMatchObject([
      { label: "Orcinus orca", excluded: true },
    ]);
  });

  it("removes one value on its own", async () => {
    open("eovs=oxygen");
    await waitFor(() => expect(group("eovs")?.items).toHaveLength(1));

    act(() => group("eovs").items[0].remove());

    await waitFor(() => expect(group("eovs")).toBeUndefined());
  });
});
