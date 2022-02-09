const wkt = require("wkt");
const unique = (arr) => [...new Set(arr)];

/***
 * Check if a string is a polygon in the form of [[lat,lon],[lat,lon],[lat,lon]..]
 *
 */
function polygonJSONToWKT(polygon) {
  try {
    const wktPolygon =
      "POLYGON((" +
      JSON.parse(polygon)
        .map(([lat, lon]) => `${lat} ${lon}`)
        .join() +
      "))";
    const wktInstance = wkt.parse(wktPolygon);

    if (
      wktInstance.type === "Polygon" &&
      wktInstance.coordinates[0].length >= 4
    )
      return wktPolygon;
    return false;
  } catch (e) {
    console.error(e);
    return false;
  }
}
// returns true for rectangles, false for rotated rectangles
function polygonIsRectangle(polygon) {
  if (polygon.length !== 5) return false;
  const p = polygon.slice(0, 4);

  const lons = unique(p.map((e) => e[0]));
  const lats = unique(p.map((e) => e[1]));

  return lons.length == 2 && lats.length == 2;
}

// translate a rectangular polygon to a bounding box query using lat/long min/max
function polygonToMaxMins(polygon) {
  const p = polygon.slice(0, 4);

  const lons = unique(p.map((e) => e[0]));
  const lats = unique(p.map((e) => e[1]));

  return {
    latMin: Math.min(...lats),
    lonMin: Math.min(...lons),
    latMax: Math.max(...lats),
    lonMax: Math.max(...lons),
  };
}

module.exports = { polygonJSONToWKT, polygonIsRectangle, polygonToMaxMins };
