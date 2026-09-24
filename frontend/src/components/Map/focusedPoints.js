// Hex and marker features carry the datasets they aggregate as a JSON array
// of pks (MapLibre hands nested properties back as strings).
export const featureHasDataset = (feature, pk) => {
  try {
    return JSON.parse(feature.properties.datasets).includes(pk);
  } catch {
    return false;
  }
};

// The focused dataset's markers, copied out of queryRenderedFeatures hits into
// a GeoJSON collection so they can be redrawn above the greyed rest. A marker
// near a tile edge is returned once per tile whose buffer holds it, hence the
// dedupe on the promoted pk.
export function focusedPointFeatures(hits, pk) {
  const byId = new Map();
  if (pk !== undefined) {
    hits.forEach((feature) => {
      if (byId.has(feature.id) || !featureHasDataset(feature, pk)) return;
      byId.set(feature.id, {
        type: "Feature",
        id: feature.id,
        geometry: feature.geometry,
        properties: { ...feature.properties },
      });
    });
  }
  return { type: "FeatureCollection", features: [...byId.values()] };
}
