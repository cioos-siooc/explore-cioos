import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../test/renderWithProviders.jsx";
import { installMockFetch } from "../test/mockFetch.js";
import useActiveFilters from "./useActiveFilters.js";

function Probe() {
  const keys = useActiveFilters().map((f) => f.key);
  return <span data-testid="keys">{keys.join(",")}</span>;
}

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

  // The geometry layers live in MapState rather than FilterProvider, which is
  // why the count the Filters badge shows used to come up short when one was
  // on.
  it("counts a narrowed geometry selection", async () => {
    open("layers=profile");
    await waitFor(() => expect(keys()).toContain("dataLayers"));
  });

  // The quick filters have their own buttons on the map and no rows in the
  // Filters modal, so the badge that sits on that modal must not count them —
  // it would be reporting filters the dialog it opens cannot change.
  it("ignores the quick filters, which the Filters modal does not own", async () => {
    open(
      "search=temperature&onlyInView=true&latMin=48.0000&lonMin=-130.0000&latMax=55.0000&lonMax=-120.0000",
    );
    await waitFor(() => expect(screen.getByTestId("keys")).toBeInTheDocument());
    expect(keys()).toEqual([]);
  });

  it("counts every one it does own together", async () => {
    open(
      "eovs=oxygen&layers=profile&onlyInView=true&latMin=48.0000&lonMin=-130.0000&latMax=55.0000&lonMax=-120.0000",
    );
    await waitFor(() => expect(keys()).toHaveLength(2));
    expect(keys().sort()).toEqual(["dataLayers", "eovs"].sort());
  });
});
