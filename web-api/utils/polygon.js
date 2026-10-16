const wkt = require("wkt");

// Input pairs are GeoJSON-order [lon, lat], and WKT reads X Y, so no swap.
// Returns false for an invalid ring: binding false into ST_GeomFromText is a
// 500.
function polygonJSONToWKT(polygon) {
  try {
    const wktPolygon = `POLYGON((${JSON.parse(polygon)
      .map(([lon, lat]) => `${lon} ${lat}`)
      .join()}))`;
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
