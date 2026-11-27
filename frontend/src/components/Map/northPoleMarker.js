import { Marker } from "maplibre-gl";

// A DOM marker, as a style point would be clamped to mercator's 85.05°N.
export function createNorthPoleMarker() {
  const element = document.createElement("div");
  element.className = "northPoleMarker";
  const label = document.createElement("span");
  element.append(label);
  // Anchored on the dot, not the dot-and-label box.
  const marker = new Marker({ element, anchor: "top", offset: [0, -3] });
  marker.setLngLat([0, 90]);

  return {
    element,
    setLabel(text) {
      label.textContent = text;
    },
    // Mercator has no 90°N to put it on.
    sync(map) {
      if (map?.getProjection()?.type === "globe") marker.addTo(map);
      else marker.remove();
    },
  };
}
