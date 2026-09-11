import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { renderWithProviders } from "../../../test/renderWithProviders.jsx";
import { installMockFetch } from "../../../test/mockFetch.js";
import LegendFooter from "./LegendFooter.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";

// Map.jsx is out of scope for unit tests (see src/test/stubs/maplibre.js) — but
// LegendFooter only needs a mapInstance object to adopt its scale/attribution
// controls onto, which the maplibre-gl stub's Map class provides well enough
// for onAdd/onRemove to run without throwing.
import { Map as StubMap } from "maplibre-gl";

function Harness() {
  const { setMapInstance } = useMapState();
  React.useEffect(() => {
    setMapInstance(new StubMap());
  }, [setMapInstance]);
  return <LegendFooter />;
}

describe("LegendFooter", () => {
  beforeEach(() => {
    installMockFetch();
  });

  it("adopts the scale control once a map instance is published", async () => {
    renderWithProviders(<Harness />, { providers: "app" });
    await waitFor(() => {
      expect(
        document.querySelector(".legendScale").children.length,
      ).toBeGreaterThan(0);
    });
  });

  it("the credits button toggles the credits panel open/closed", async () => {
    const { user } = renderWithProviders(<Harness />, { providers: "app" });
    const button = await screen.findByTitle("Basemap sources and credits");
    expect(button).toHaveAttribute("aria-expanded", "false");
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(document.querySelector(".legendCredits")).not.toHaveAttribute(
      "hidden",
    );
  });
});
