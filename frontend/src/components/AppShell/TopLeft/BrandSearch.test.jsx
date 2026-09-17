import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import BrandSearch from "./BrandSearch.jsx";

describe("BrandSearch", () => {
  beforeEach(() => {
    installMockFetch();
  });

  // The projection toggle writes nothing of its own — it flips the same map
  // state the URL seeds and the map reads — so it is asserted through that
  // state rather than through the button's own markup.
  function renderBrand(url = "/") {
    const seen = [];
    function Probe() {
      seen.push(useMapState().projection);
      return null;
    }
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <BrandSearch />
        <Probe />
      </>,
      { url, providers: "app" },
    );
    return { user, seen };
  }

  it("flips the map projection, and names the projection it would flip to", async () => {
    const { user, seen } = renderBrand();

    expect(seen.at(-1)).toBe("mercator");
    await user.click(screen.getByTitle("Switch to globe view"));
    await waitFor(() => expect(seen.at(-1)).toBe("globe"));

    await user.click(screen.getByTitle("Switch to flat map view"));
    await waitFor(() => expect(seen.at(-1)).toBe("mercator"));
  });

  it("opens already flipped when the address asks for the globe", async () => {
    const { seen } = renderBrand("/?globe=true");

    expect(seen.at(-1)).toBe("globe");
    expect(screen.getByTitle("Switch to flat map view")).toBeInTheDocument();
  });
});
