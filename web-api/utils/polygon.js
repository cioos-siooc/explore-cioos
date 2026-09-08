const wkt = require("wkt");

/** *
 * Convert the frontend's selection ring to a WKT POLYGON.
 *
 * The ring arrives as a JSON array of GeoJSON-order `[lon, lat]` pairs: it is
 * produced by turf's `bboxPolygon` / mapbox-gl-draw's own rings and serialized
 * verbatim by `createSelectionQueryString` (frontend/src/utilities.jsx), both of
 * which are lon-first. WKT — and `ST_GeomFromText(…, 4326)` after it — reads
 * `X Y`, i.e. lon first as well, so each pair is emitted in the order it
 * arrives. (This function previously named the pair `[lat, lon]` while emitting
 * it unswapped; the names were wrong, the WKT was right.)
 *
 * Returns `false` for anything that is not a valid closed ring. Callers must
 * check the return value — binding `false` into `ST_GeomFromText` is a 500.
 */
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
