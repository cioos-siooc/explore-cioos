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

module.exports = { polygonJSONToWKT };
