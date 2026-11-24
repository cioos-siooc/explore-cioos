import { describe, it, expect, vi } from "vitest";
import { Marker } from "maplibre-gl";

import { createNorthPoleMarker } from "./northPoleMarker.js";

const mapIn = (type) => ({ getProjection: () => ({ type }) });

describe("createNorthPoleMarker", () => {
  it("is shown on the globe only", () => {
    const addTo = vi.spyOn(Marker.prototype, "addTo");
    const remove = vi.spyOn(Marker.prototype, "remove");
    const pole = createNorthPoleMarker();

    const globe = mapIn("globe");
    pole.sync(globe);
    expect(addTo).toHaveBeenCalledWith(globe);

    pole.sync(mapIn("mercator"));
    expect(remove).toHaveBeenCalledTimes(1);

    pole.sync(null);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(addTo).toHaveBeenCalledTimes(1);
  });

  it("sits at 90°N and carries the given label", () => {
    const setLngLat = vi.spyOn(Marker.prototype, "setLngLat");
    const pole = createNorthPoleMarker();
    pole.setLabel("Pôle Nord");

    expect(setLngLat).toHaveBeenCalledWith([0, 90]);
    expect(pole.element).toHaveTextContent("Pôle Nord");
  });
});
