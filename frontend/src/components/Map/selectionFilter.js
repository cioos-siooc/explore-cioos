// A feature touching the shape is at distance 0, matching the dataset list's
// intersects test. A filter, unlike a paint value, is always evaluated with
// the tile geometry 'distance' needs.
export function selectionLayerFilter(baseFilter, ring) {
  if (!ring) return baseFilter ?? null;
  const inside = [
    "==",
    ["distance", { type: "Polygon", coordinates: [ring] }],
    0,
  ];
  return baseFilter ? ["all", baseFilter, inside] : inside;
}
